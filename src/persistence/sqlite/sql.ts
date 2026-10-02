import { AppError } from '@loge/api';

import type { Logger } from '@/services/ports';

import { storageError } from '../errors';

/** Booleans are stored as 0 and 1: not every engine binds them. */
export type SqlValue = string | number | null;

export interface SqlExecutor {
  run(sql: string, params?: readonly SqlValue[]): Promise<{ readonly changes: number }>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<readonly T[]>;
  exec(sql: string): Promise<void>;
}

export interface TransactionOptions {
  /**
   * For a migration that rebuilds a table. SQLite ignores the foreign-keys
   * pragma inside a transaction, so it is switched off before BEGIN, and the
   * keys are checked before COMMIT.
   */
  readonly foreignKeys?: 'off';
}

export interface SqlDatabase extends SqlExecutor {
  /** BEGIN IMMEDIATE … COMMIT, or ROLLBACK when `work` throws. Nothing else runs meanwhile. */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>, options?: TransactionOptions): Promise<T>;
  close(): Promise<void>;
}

/** What an engine binding provides: statements on one connection, in no particular order. */
export interface SqlConnection extends SqlExecutor {
  close(): Promise<void>;
}

const noop = () => undefined;

/**
 * One statement at a time, on one connection. A transaction holds the queue
 * from BEGIN to COMMIT, because SQLite folds whatever else runs on the
 * connection meanwhile into the open transaction — the flaw of expo-sqlite's
 * `withTransactionAsync`. Its `withExclusiveTransactionAsync` is no way out:
 * it opens a second connection, and foreign keys, which are per connection,
 * are off there, so no cascade would fire.
 */
export function serializeSqlConnection(
  connection: SqlConnection,
  options: { readonly log?: Logger; readonly stallMs?: number } = {},
): SqlDatabase {
  const { log, stallMs } = options;
  let tail: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    // Waiting this long means a transaction is awaiting something queued behind it.
    const stall =
      log && stallMs
        ? setTimeout(
            () => log.error('storage', `A statement has waited ${stallMs} ms behind a transaction that is awaiting something other than the database.`),
            stallMs,
          )
        : undefined;
    const run = tail.then(() => {
      clearTimeout(stall);
      return job();
    });
    tail = run.then(noop, noop);
    return run;
  };

  const fail = (error: unknown): never => {
    log?.error('storage', 'A statement failed', { error: String(error) });
    throw storageError(error);
  };

  // Straight to the connection, for use inside a job that holds the queue.
  const direct: SqlExecutor = {
    run: (sql, params) => connection.run(sql, params).catch(fail),
    get: <T>(sql: string, params?: readonly SqlValue[]) => connection.get<T>(sql, params).catch(fail),
    all: <T>(sql: string, params?: readonly SqlValue[]) => connection.all<T>(sql, params).catch(fail),
    exec: (sql) => connection.exec(sql).catch(fail),
  };

  return {
    run: (sql, params) => enqueue(() => direct.run(sql, params)),
    get: <T>(sql: string, params?: readonly SqlValue[]) => enqueue(() => direct.get<T>(sql, params)),
    all: <T>(sql: string, params?: readonly SqlValue[]) => enqueue(() => direct.all<T>(sql, params)),
    exec: (sql) => enqueue(() => direct.exec(sql)),
    transaction: (work, transactionOptions) =>
      enqueue(async () => {
        const foreignKeysOff = transactionOptions?.foreignKeys === 'off';
        let open = true;
        const check = () => {
          if (!open) throw new Error('This transaction has already ended.');
        };
        const tx: SqlExecutor = {
          run: async (sql, params) => {
            check();
            return direct.run(sql, params);
          },
          get: async <T>(sql: string, params?: readonly SqlValue[]) => {
            check();
            return direct.get<T>(sql, params);
          },
          all: async <T>(sql: string, params?: readonly SqlValue[]) => {
            check();
            return direct.all<T>(sql, params);
          },
          exec: async (sql) => {
            check();
            return direct.exec(sql);
          },
        };
        if (foreignKeysOff) await direct.exec('PRAGMA foreign_keys = OFF');
        try {
          await direct.exec('BEGIN IMMEDIATE');
          try {
            const result = await work(tx);
            if (foreignKeysOff && (await direct.all('PRAGMA foreign_key_check')).length > 0) {
              throw new AppError('STORAGE_FAILURE', 'An upgrade of the data on this device left rows pointing at nothing.', {
                retry: 'never',
              });
            }
            await direct.exec('COMMIT');
            return result;
          } catch (error) {
            await connection.exec('ROLLBACK').catch(noop);
            throw error;
          }
        } finally {
          open = false;
          if (foreignKeysOff) await direct.exec('PRAGMA foreign_keys = ON');
        }
      }),
    close: () => enqueue(() => connection.close().catch(fail)),
  };
}
