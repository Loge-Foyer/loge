import { AppError } from '@sc/api';

import type { Logger } from '@/services/ports';

import { storageError } from '../errors';

/** What the browser provides, passed in so tests can hand over an in-memory IndexedDB. */
export interface IndexedDbEnvironment {
  readonly indexedDB: IDBFactory;
  readonly IDBKeyRange: Pick<typeof IDBKeyRange, 'lowerBound' | 'upperBound'>;
}

const isEngineError = (error: unknown): error is DOMException =>
  typeof DOMException !== 'undefined' && error instanceof DOMException;

/** A transaction that kept going after IndexedDB had committed it, because it waited on something else. */
function committedEarly(cause: unknown): AppError {
  return new AppError(
    'STORAGE_FAILURE',
    'A database transaction waited on something other than the database, and IndexedDB committed it early. Do that work before or after the transaction.',
    { retry: 'never', cause },
  );
}

/** What IndexedDB threw, as the typed error the rest of the app handles. */
export function engineError(error: DOMException | null): AppError {
  if (error?.name === 'TransactionInactiveError') return committedEarly(error);
  if (error?.name === 'QuotaExceededError') {
    return new AppError('STORAGE_FAILURE', 'This browser has no room left for Streaming Center’s data.', { cause: error });
  }
  return storageError(error);
}

/** An engine error explained; anything else — a service's own error from inside a transaction — as it was. */
export function explain(error: unknown): unknown {
  return isEngineError(error) ? engineError(error) : error;
}

export function request<T>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    // Left to bubble: an unhandled request error aborts the whole transaction, which is the point.
    pending.onerror = () => reject(engineError(pending.error));
  });
}

/** Steps through a cursor until it ends or `step` returns false. */
export function walk(pending: IDBRequest<IDBCursorWithValue | null>, step: (cursor: IDBCursorWithValue) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => {
      const cursor = pending.result;
      if (!cursor || !step(cursor)) {
        resolve();
        return;
      }
      cursor.continue();
    };
    pending.onerror = () => reject(engineError(pending.error));
  });
}

/**
 * Opens the database at `version`, upgrading it one version at a time. Each
 * step runs in a version-change transaction of its own, so it reads what the
 * steps before it committed — never a record an earlier step's cursor has yet
 * to write back, as it could inside one shared transaction.
 */
export async function openIndexedDb(
  factory: IDBFactory,
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, from: number, tx: IDBTransaction) => void,
  options: { readonly log: Logger; readonly onClose: () => void },
): Promise<IDBDatabase> {
  // Where it stands. Opening without a version makes a missing database at 1, and that is the first step.
  const probe = await openOnce(factory, name, undefined, upgrade, options);
  const current = probe.version;
  probe.close();
  for (let next = current + 1; next <= version; next += 1) {
    (await openOnce(factory, name, next, upgrade, options)).close();
  }
  const db = await openOnce(factory, name, version, undefined, options);
  // Another tab is upgrading the schema: step aside, or it waits for ever.
  db.onversionchange = () => {
    db.close();
    options.onClose();
    options.log.warn('storage', 'Another tab updated the database. Reload this one to keep going.');
  };
  return db;
}

function openOnce(
  factory: IDBFactory,
  name: string,
  version: number | undefined,
  upgrade: ((db: IDBDatabase, from: number, tx: IDBTransaction) => void) | undefined,
  options: { readonly log: Logger },
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = version === undefined ? factory.open(name) : factory.open(name, version);
    opening.onupgradeneeded = (event) => {
      // Always there during an upgrade; the steps rewrite records through it.
      const tx = opening.transaction;
      if (tx && upgrade) upgrade(opening.result, event.oldVersion, tx);
    };
    opening.onblocked = () => options.log.warn('storage', 'Waiting for another tab to let go of the database.');
    opening.onerror = () => {
      reject(
        opening.error?.name === 'VersionError'
          ? new AppError('STORAGE_FAILURE', 'The data in this browser was saved by a newer version of Streaming Center. Reload the page to update it.', {
              retry: 'never',
              cause: opening.error,
            })
          : engineError(opening.error),
      );
    };
    opening.onsuccess = () => resolve(opening.result);
  });
}

/**
 * Runs `work` in one transaction, resolving once it has committed. IndexedDB
 * commits by itself as soon as no request is pending, so `work` must await
 * nothing but the transaction's own requests; one that does is reported, not
 * silently half-applied.
 */
export function runTransaction<T>(
  db: IDBDatabase,
  stores: readonly string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([...stores], mode);
    } catch (error) {
      reject(explain(error));
      return;
    }
    let outcome: { readonly value: T } | { readonly error: unknown } | undefined;
    let finished = false;
    tx.oncomplete = () => {
      finished = true;
      if (outcome && 'value' in outcome) resolve(outcome.value);
      else if (outcome) reject(outcome.error);
    };
    tx.onabort = () => {
      finished = true;
      reject(outcome && 'error' in outcome ? outcome.error : engineError(tx.error));
    };
    work(tx).then(
      (value) => {
        outcome = { value };
        if (finished) resolve(value);
      },
      (error: unknown) => {
        // Still at work after the commit: it waited on something else in between.
        outcome = { error: finished ? committedEarly(error) : explain(error) };
        if (finished) {
          reject(outcome.error);
          return;
        }
        try {
          tx.abort();
        } catch {
          // Already aborting: the request that failed took the transaction down with it.
        }
      },
    );
  });
}
