import { connectionId, userId } from '@sc/api';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { createIndexedDbDatabase } from '@/persistence/indexeddb/database';
import { INDEXEDDB_UPGRADES, INDEXEDDB_VERSION, STORES, upgradeIndexedDb } from '@/persistence/indexeddb/migrations';
import { prepareSqlite } from '@/persistence/sqlite/database';
import { MIGRATIONS, migrate, type SqlMigration } from '@/persistence/sqlite/migrations';
import { serializeSqlConnection } from '@/persistence/sqlite/sql';

import { openTestDatabase, tempDatabasePath } from './support/engines';
import { counterIds, fakeClock, silentLog } from './support/fakes';
import { nodeSqliteConnection } from './support/node-sqlite';

const tempFile = tempDatabasePath;

async function versionOf(path: string) {
  const db = serializeSqlConnection(nodeSqliteConnection(path));
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  await db.close();
  return row?.user_version;
}

describe('SQLite migrations', () => {
  it('create every table on an empty database, and switch foreign keys on', async () => {
    const db = await prepareSqlite(serializeSqlConnection(nodeSqliteConnection()));
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map(
      (row) => row.name,
    );
    expect(tables).toEqual([
      'change_journal',
      'connection_profile_values',
      'connections',
      'device_settings',
      'media_details',
      'media_lists',
      'preferences',
      'stale_secrets',
      'sync_state',
      'users',
    ]);
    expect((await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(MIGRATIONS.length);
    expect((await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
  });

  it('leave an up-to-date database as it is', async () => {
    const path = tempFile();
    const first = openTestDatabase('sqlite', { clock: fakeClock(), path });
    await first.users.insert({ id: userId('u-alex'), name: 'Alex' });
    const again = openTestDatabase('sqlite', { clock: fakeClock(), path });
    expect(await again.users.list()).toEqual([{ id: 'u-alex', name: 'Alex' }]);
    expect(await versionOf(path)).toBe(MIGRATIONS.length);
  });

  it('refuse a database saved by a newer version, and change nothing in it', async () => {
    const path = tempFile();
    const raw = serializeSqlConnection(nodeSqliteConnection(path));
    await raw.exec('PRAGMA user_version = 99');
    await raw.close();

    const db = openTestDatabase('sqlite', { clock: fakeClock(), path });
    await expect(db.users.list()).rejects.toMatchObject({ code: 'STORAGE_FAILURE', retry: 'never' });
    expect(await versionOf(path)).toBe(99);
  });

  it('roll a failing step back, version and all, and try it again on the next call', async () => {
    const path = tempFile();
    let fail = true;
    const migrations: readonly SqlMigration[] = [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        up: async (tx) => {
          await tx.exec('CREATE TABLE extra (id TEXT PRIMARY KEY NOT NULL) STRICT');
          if (fail) throw new Error('The step broke half-way.');
        },
      },
    ];
    const db = openTestDatabase('sqlite', { clock: fakeClock(), path, migrations });
    await expect(db.users.list()).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
    expect(await versionOf(path)).toBe(MIGRATIONS.length);

    fail = false;
    await expect(db.users.list()).resolves.toEqual([]);
    expect(await versionOf(path)).toBe(MIGRATIONS.length + 1);
  });

  it('rebuild a parent table with foreign keys off, keeping every child row', async () => {
    const path = tempFile();
    const before = openTestDatabase('sqlite', { clock: fakeClock(), path });
    await before.users.insert({ id: userId('u-alex'), name: 'Alex' });
    await before.preferences.update(userId('u-alex'), () => ({ homeLayout: { version: 1, rows: [] } }));

    // The twelve-step table rebuild SQLite documents: dropping `users` with
    // foreign keys on would take every child row with it.
    const rebuild: SqlMigration = {
      version: MIGRATIONS.length + 1,
      foreignKeysOff: true,
      up: async (tx) => {
        await tx.exec(`
          CREATE TABLE users_next (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, pin_credential_ref TEXT,
            position INTEGER NOT NULL, version INTEGER NOT NULL, avatar TEXT) STRICT;
          INSERT INTO users_next (id, name, pin_credential_ref, position, version)
            SELECT id, name, pin_credential_ref, position, version FROM users;
          DROP TABLE users;
          ALTER TABLE users_next RENAME TO users;
        `);
      },
    };
    const after = openTestDatabase('sqlite', { clock: fakeClock(), path, migrations: [...MIGRATIONS, rebuild] });
    expect((await after.preferences.get(userId('u-alex'))).homeLayout).toEqual({ version: 1, rows: [] });

    // And the keys are back on afterwards: deleting the profile still cascades.
    await after.users.delete(userId('u-alex'));
    expect(await after.preferences.get(userId('u-alex'))).toEqual({});
  });

  it('carry a v1 database over to v2: every row kept, old entries without an id, no connection left as the account', async () => {
    const path = tempFile();
    const v1 = await prepareSqlite(serializeSqlConnection(nodeSqliteConnection(path)), MIGRATIONS.slice(0, 1));
    await v1.exec(`
      INSERT INTO users (id, name, pin_credential_ref, position, version) VALUES ('u-alex', 'Alex', NULL, 1, 1);
      INSERT INTO connections (id, plugin_id, label, roles, per_profile, fields, settings, credentials_ref, secret_keys, position, version)
        VALUES ('c-sync', 'custom-server', 'Sync', '{"sync":true}', 'none', '{}', '{}', NULL, NULL, 1, 1),
               ('c-both', 'mock', 'Mock', '{"media":true,"sync":true}', 'none', '{}', '{}', NULL, NULL, 2, 1);
      INSERT INTO change_journal (user_id, entity, entity_id, operation, changed_at, local_version)
        VALUES ('u-alex', 'user', 'u-alex', 'upsert', 1, 1);
    `);
    await v1.close();

    const db = openTestDatabase('sqlite', { clock: fakeClock(), path });
    expect(await db.users.list()).toEqual([{ id: 'u-alex', name: 'Alex' }]);
    expect((await db.connections.list()).map((connection) => [connection.id, connection.roles])).toEqual([
      ['c-sync', { sync: false }],
      ['c-both', { media: true, sync: false }],
    ]);
    const [old] = await db.journal.entries();
    expect(old).toMatchObject({ entity: 'user', entityId: 'u-alex' });
    expect(old?.changeId).toBeUndefined();
    expect(await db.syncState.get(connectionId('c-sync'))).toBeUndefined();
    expect(await versionOf(path)).toBe(MIGRATIONS.length);
  });

  it('insist on steps numbered one after another', async () => {
    const db = await prepareSqlite(serializeSqlConnection(nodeSqliteConnection()), []);
    await expect(migrate(db, [{ version: 2, up: async () => undefined }])).rejects.toThrow('numbered 2');
  });
});

describe('IndexedDB upgrades', () => {
  const open = (indexedDB: IDBFactory) =>
    createIndexedDbDatabase({ indexedDB, IDBKeyRange }, 'streaming-center', { clock: fakeClock(), ids: counterIds('change-'), log: silentLog });

  const rawOpen = (indexedDB: IDBFactory, version?: number) =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const opening = version === undefined ? indexedDB.open('streaming-center') : indexedDB.open('streaming-center', version);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });

  it('create every store on an empty database', async () => {
    const indexedDB = new IDBFactory();
    await open(indexedDB).users.list();
    const db = await rawOpen(indexedDB);
    expect(db.version).toBe(INDEXEDDB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([...STORES].sort());
    db.close();
  });

  it('carry a v1 database over to v2: every record kept, no connection left as the account', async () => {
    const indexedDB = new IDBFactory();
    const v1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('streaming-center', 1);
      opening.onupgradeneeded = () => {
        const tx = opening.transaction;
        if (!tx) throw new Error('no upgrade transaction');
        upgradeIndexedDb(opening.result, 0, tx, INDEXEDDB_UPGRADES.slice(0, 1));
        tx.objectStore('users').add({ id: 'u-alex', name: 'Alex', position: 1, version: 1 });
        tx.objectStore('connections').add({
          id: 'c-both',
          pluginId: 'mock',
          label: 'Mock',
          roles: { media: true, sync: true },
          perProfile: 'none',
          values: { fields: {}, settings: {} },
          position: 1,
          version: 1,
        });
        tx.objectStore('journal').add({ userId: 'u-alex', entity: 'user', entityId: 'u-alex', operation: 'upsert', changedAt: 1, localVersion: 1 });
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    v1.close();

    const db = open(indexedDB);
    expect(await db.users.list()).toEqual([{ id: 'u-alex', name: 'Alex' }]);
    expect((await db.connections.list()).map((connection) => connection.roles)).toEqual([{ media: true, sync: false }]);
    const [old] = await db.journal.entries();
    expect(old).toMatchObject({ entity: 'user', entityId: 'u-alex' });
    expect(old?.changeId).toBeUndefined();
    expect(await db.syncState.get(connectionId('c-both'))).toBeUndefined();
  });

  it('refuse data saved by a newer version of the app', async () => {
    const indexedDB = new IDBFactory();
    (await rawOpen(indexedDB, INDEXEDDB_VERSION + 1)).close();
    await expect(open(indexedDB).users.list()).rejects.toMatchObject({ code: 'STORAGE_FAILURE', retry: 'never' });
  });

  it('step aside for another tab’s upgrade, and then say this page is out of date', async () => {
    const indexedDB = new IDBFactory();
    const db = open(indexedDB);
    await db.users.insert({ id: userId('u-alex'), name: 'Alex' });
    // Another tab, running a newer version, upgrades the schema.
    (await rawOpen(indexedDB, INDEXEDDB_VERSION + 1)).close();
    await expect(db.users.list()).rejects.toMatchObject({ code: 'STORAGE_FAILURE', retry: 'never' });
  });

  it('report a transaction that waited on something else, rather than let it pass as done', async () => {
    const db = open(new IDBFactory());
    const failure = db.transaction(async (tx) => {
      await tx.users.insert({ id: userId('u-alex'), name: 'Alex' });
      // A timer — or a keychain call, a fetch, WebCrypto — lets IndexedDB commit.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await tx.users.insert({ id: userId('u-kids'), name: 'Kids' });
    });
    await expect(failure).rejects.toMatchObject({ code: 'STORAGE_FAILURE', message: expect.stringContaining('before or after the transaction') });
  });
});
