import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { createIndexedDbDatabase } from '@/persistence/indexeddb/database';
import type { SqlMigration } from '@/persistence/sqlite/migrations';
import { createSqliteDatabase } from '@/persistence/sqlite/database';
import { serializeSqlConnection } from '@/persistence/sqlite/sql';
import type { Clock, IdGenerator, Logger, Repositories, SyncDatabase } from '@/services/ports';

import { counterIds, silentLog } from './fakes';
import { nodeSqliteConnection } from './node-sqlite';

export type Engine = 'sqlite' | 'indexeddb';

export const ENGINES: readonly Engine[] = ['sqlite', 'indexeddb'];

export interface TestDatabaseOptions {
  readonly clock: Clock;
  /** Change ids. Two devices in one test need different ones, as two phones would have. */
  readonly ids?: IdGenerator;
  readonly log?: Logger;
  /** SQLite: a file, to open the same database twice. In memory otherwise. */
  readonly path?: string;
  /** IndexedDB: the same in-memory browser storage, to open the same database twice. A fresh one otherwise. */
  readonly indexedDB?: IDBFactory;
  readonly migrations?: readonly SqlMigration[];
}

const tempDirectories: string[] = [];

/** A SQLite file in a directory of its own, deleted after the test file (`test/support/setup.ts`). */
export function tempDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sc-db-'));
  tempDirectories.push(directory);
  return join(directory, 'test.db');
}

export function removeTempDatabases(): void {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
}

/** Where a database lives that a test opens more than once — a restart. */
export function reopenable(engine: Engine): Pick<TestDatabaseOptions, 'path' | 'indexedDB'> {
  return engine === 'sqlite' ? { path: tempDatabasePath() } : { indexedDB: new IDBFactory() };
}

/** A fresh database on the real engine, with the committed migrations. */
export function openTestDatabase(engine: Engine, options: TestDatabaseOptions): SyncDatabase {
  const log = options.log ?? silentLog;
  const ids = options.ids ?? counterIds('change-');
  if (engine === 'sqlite') {
    const db = createSqliteDatabase(async () => serializeSqlConnection(nodeSqliteConnection(options.path), { log }), {
      clock: options.clock,
      ids,
      log,
      ...(options.migrations ? { migrations: options.migrations } : {}),
    });
    return guarded(db);
  }
  const env = { indexedDB: options.indexedDB ?? new IDBFactory(), IDBKeyRange };
  return guarded(createIndexedDbDatabase(env, 'streaming-center', { clock: options.clock, ids, log }));
}

/**
 * Refuses a call to the database made from inside one of its own
 * transactions. On SQLite that call would wait for the transaction, which
 * waits for it, for ever; on IndexedDB it would run outside the transaction.
 * Either way the test should fail at once, and say why.
 */
export function guarded(db: SyncDatabase): SyncDatabase {
  const inside = new AsyncLocalStorage<true>();
  const refuse = () => {
    if (inside.getStore()) throw new Error('A transaction called the database directly. Use the repositories it was given.');
  };
  const wrap = <R extends object>(repository: R): R =>
    Object.fromEntries(
      Object.entries(repository).map(([name, method]) => [
        name,
        (...args: unknown[]) => {
          refuse();
          return (method as (...params: unknown[]) => unknown)(...args);
        },
      ]),
    ) as R;
  const repositories: Repositories = {
    users: wrap(db.users),
    connections: wrap(db.connections),
    deviceSettings: wrap(db.deviceSettings),
    preferences: wrap(db.preferences),
    mediaCache: wrap(db.mediaCache),
    staleSecrets: wrap(db.staleSecrets),
    syncState: wrap(db.syncState),
    journal: wrap(db.journal),
  };
  return {
    ...repositories,
    transaction: async (work) => {
      refuse();
      return db.transaction((tx) => inside.run(true, () => work(tx)));
    },
    unjournaled: async (work) => {
      refuse();
      return db.unjournaled((tx) => inside.run(true, () => work(tx)));
    },
    journal: { ...wrap(db.journal), subscribe: db.journal.subscribe },
  };
}

/**
 * Every row of every table or store, read around the repositories, as text —
 * what someone who copied the database file would see.
 */
export async function dumpDatabase(engine: Engine, where: Pick<TestDatabaseOptions, 'path' | 'indexedDB'>): Promise<string> {
  if (engine === 'sqlite') {
    const db = serializeSqlConnection(nodeSqliteConnection(where.path));
    const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    const rows: unknown[] = [];
    for (const { name } of tables) rows.push(name, ...(await db.all(`SELECT * FROM "${name}"`)));
    await db.close();
    return JSON.stringify(rows);
  }
  const factory = where.indexedDB;
  if (!factory) throw new Error('Nothing to dump: open the database with reopenable().');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open('streaming-center');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const rows: unknown[] = [];
  for (const name of [...db.objectStoreNames]) {
    const all = db.transaction(name).objectStore(name).getAll();
    rows.push(
      name,
      ...(await new Promise<unknown[]>((resolve, reject) => {
        all.onsuccess = () => resolve(all.result);
        all.onerror = () => reject(all.error);
      })),
    );
  }
  db.close();
  return JSON.stringify(rows);
}
