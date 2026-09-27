import { AppError } from '@sc/api';

import type { Clock, IdGenerator, Logger, Repositories, SyncDatabase } from '@/services/ports';

import { storageError } from '../errors';
import { journalListeners, standaloneRepositories } from '../standalone';
import { migrate, MIGRATIONS, type SqlMigration } from './migrations';
import { sqliteRepositories } from './repositories';
import type { SqlDatabase } from './sql';

/**
 * Makes a fresh connection usable. Foreign keys are per connection and off by
 * default, and without them no cascade fires — so they are switched on for
 * every connection and read back, rather than trusted.
 */
export async function prepareSqlite(db: SqlDatabase, migrations: readonly SqlMigration[] = MIGRATIONS): Promise<SqlDatabase> {
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');
  const check = await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
  if (check?.foreign_keys !== 1) {
    throw new AppError('STORAGE_FAILURE', 'The database on this device could not enforce its own rules.', { retry: 'never' });
  }
  await migrate(db, migrations);
  return db;
}

/**
 * The local database on SQLite. It opens on first use, so the service graph
 * can be built synchronously; a failed open is tried again on the next call,
 * which is what "Try again" on the boot screen relies on.
 */
export function createSqliteDatabase(
  open: () => Promise<SqlDatabase>,
  deps: { readonly clock: Clock; readonly ids: IdGenerator; readonly log: Logger; readonly migrations?: readonly SqlMigration[] },
): SyncDatabase {
  let ready: Promise<SqlDatabase> | undefined;
  const database = () => {
    ready ??= open()
      .then((db) => prepareSqlite(db, deps.migrations))
      .catch((error: unknown) => {
        ready = undefined;
        deps.log.error('storage', 'The database could not be opened', { error: String(error) });
        throw storageError(error, 'The data on this device could not be opened.');
      });
    return ready;
  };

  const listeners = journalListeners(deps.log);
  const read = async <T>(work: (repositories: Repositories) => Promise<T>): Promise<T> =>
    work(sqliteRepositories(await database(), { clock: deps.clock, ids: deps.ids, journaled: true }));
  const writing =
    (journaled: boolean) =>
    async <T>(work: (repositories: Repositories) => Promise<T>): Promise<T> => {
      let grew = false;
      const onJournaled = () => {
        grew = true;
      };
      const result = await (await database()).transaction((tx) =>
        work(sqliteRepositories(tx, { clock: deps.clock, ids: deps.ids, journaled, onJournaled })),
      );
      // Committed, and outside the statement queue: a listener may use the database again.
      if (grew) listeners.notify();
      return result;
    };
  const write = writing(true);

  const standalone = standaloneRepositories(read, write);
  return {
    ...standalone,
    transaction: write,
    unjournaled: writing(false),
    journal: { ...standalone.journal, subscribe: listeners.subscribe },
  };
}
