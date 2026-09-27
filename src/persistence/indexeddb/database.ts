import type { Clock, IdGenerator, Logger, Repositories, SyncDatabase } from '@/services/ports';

import { storageError } from '../errors';
import { journalListeners, standaloneRepositories } from '../standalone';
import { openIndexedDb, runTransaction, type IndexedDbEnvironment } from './idb';
import { INDEXEDDB_VERSION, STORES, upgradeIndexedDb } from './migrations';
import { indexedDbRepositories } from './repositories';

/**
 * The local database on IndexedDB, for the web. Like the SQLite one it opens
 * on first use and tries again after a failed open. Every transaction spans
 * every store: writes are small, and one scope keeps them strictly in order.
 */
export function createIndexedDbDatabase(
  env: IndexedDbEnvironment,
  name: string,
  deps: { readonly clock: Clock; readonly ids: IdGenerator; readonly log: Logger },
): SyncDatabase {
  let ready: Promise<IDBDatabase> | undefined;
  const database = () => {
    ready ??= openIndexedDb(env.indexedDB, name, INDEXEDDB_VERSION, upgradeIndexedDb, {
      log: deps.log,
      // Closed for another tab's upgrade: the next call opens again, and learns whether this page is out of date.
      onClose: () => {
        ready = undefined;
      },
    }).catch((error: unknown) => {
      ready = undefined;
      deps.log.error('storage', 'The database could not be opened', { error: String(error) });
      throw storageError(error, 'The data in this browser could not be opened.');
    });
    return ready;
  };

  const listeners = journalListeners(deps.log);
  const run =
    (mode: IDBTransactionMode, journaled: boolean) =>
    async <T>(work: (repositories: Repositories) => Promise<T>): Promise<T> => {
      let grew = false;
      const onJournaled = () => {
        grew = true;
      };
      const result = await runTransaction(await database(), STORES, mode, (tx) =>
        work(indexedDbRepositories(tx, { clock: deps.clock, ids: deps.ids, journaled, onJournaled, env })),
      );
      // Resolved on `complete`, so the entries are committed.
      if (grew) listeners.notify();
      return result;
    };
  const read = run('readonly', true);
  const write = run('readwrite', true);

  const standalone = standaloneRepositories(read, write);
  return {
    ...standalone,
    transaction: write,
    unjournaled: run('readwrite', false),
    journal: { ...standalone.journal, subscribe: listeners.subscribe },
  };
}
