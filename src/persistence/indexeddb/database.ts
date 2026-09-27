import type { Clock, JournalEntry, LocalDatabase, Logger, Repositories } from '@/services/ports';

import { storageError } from '../errors';
import { standaloneRepositories } from '../standalone';
import { openIndexedDb, request, runTransaction, type IndexedDbEnvironment } from './idb';
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
  deps: { readonly clock: Clock; readonly log: Logger },
): LocalDatabase {
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

  const run = (mode: IDBTransactionMode) => async <T>(work: (repositories: Repositories) => Promise<T>): Promise<T> =>
    runTransaction(await database(), STORES, mode, (tx) => work(indexedDbRepositories(tx, { clock: deps.clock, env })));
  const read = run('readonly');
  const write = run('readwrite');

  return {
    ...standaloneRepositories(read, write),
    transaction: write,
    journal: {
      entries: async (after = 0) =>
        runTransaction(await database(), ['journal'], 'readonly', (tx) =>
          request(tx.objectStore('journal').getAll(env.IDBKeyRange.lowerBound(after, true)) as IDBRequest<JournalEntry[]>),
        ),
    },
  };
}
