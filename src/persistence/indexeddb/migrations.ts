import { qualifiedIdOf, qualifiedPluginStates, sessionRefOf } from '../plugin-ids';

/**
 * The object stores, as IndexedDB's versioned upgrades. They mirror the SQLite
 * tables; IndexedDB has no foreign keys, so the repositories cascade by hand
 * through the `byUser` and `byConnection` indexes, inside one transaction.
 */
export const STORES = [
  'users',
  'deviceSettings',
  'connections',
  'connectionProfileValues',
  'preferences',
  'journal',
  'staleSecrets',
  'mediaLists',
  'mediaDetails',
  'account',
  'backupState',
  'watchStatus',
  'outbox',
  'downloads',
  'subscriptions',
  'playlists',
  'favoriteChannels',
  'watchProgress',
  'accountSettings',
  'identities',
] as const;

export type StoreName = (typeof STORES)[number];

/** One version's step, inside the version-change transaction — which it may use to rewrite records. */
export type Upgrade = (db: IDBDatabase, tx: IDBTransaction) => void;

// One entry per version, never edited once shipped: version n runs INDEXEDDB_UPGRADES[n - 1].
export const INDEXEDDB_UPGRADES: readonly Upgrade[] = [
  (db) => {
    db.createObjectStore('users', { keyPath: 'id' }).createIndex('byPosition', 'position');
    db.createObjectStore('deviceSettings', { keyPath: 'key' });
    db.createObjectStore('connections', { keyPath: 'id' }).createIndex('byPosition', 'position');
    const values = db.createObjectStore('connectionProfileValues', { keyPath: ['connectionId', 'userId'] });
    values.createIndex('byUser', 'userId');
    values.createIndex('byConnection', 'connectionId');
    db.createObjectStore('preferences', { keyPath: ['userId', 'key'] }).createIndex('byUser', 'userId');
    db.createObjectStore('journal', { keyPath: 'seq', autoIncrement: true });
    db.createObjectStore('staleSecrets', { keyPath: 'ref' });
    for (const [store, keyPath] of [
      ['mediaLists', ['userId', 'connectionId', 'listKey']],
      ['mediaDetails', ['userId', 'connectionId', 'externalId']],
    ] as const) {
      const saved = db.createObjectStore(store, { keyPath: [...keyPath] });
      saved.createIndex('byUser', 'userId');
      saved.createIndex('byConnection', 'connectionId');
      saved.createIndex('bySavedAt', 'savedAt');
    }
  },
  // The account phase. Journal records simply gain a `changeId` from now on;
  // older ones are never sent, since every account starts with a join above them.
  (db, tx) => {
    db.createObjectStore('syncState', { keyPath: 'connectionId' });
    // "Sync on" means "the account" from now on, and none is chosen yet.
    const walking = tx.objectStore('connections').openCursor();
    walking.onsuccess = () => {
      const cursor = walking.result;
      if (!cursor) return;
      const connection = cursor.value as { readonly roles: Readonly<Record<string, boolean>> };
      if (connection.roles.sync === true) cursor.update({ ...connection, roles: { ...connection.roles, sync: false } });
      cursor.continue();
    };
  },
  // Plugins moved into category folders, and an id names its category now.
  (_db, tx) => {
    rewriteEach<{ readonly pluginId: string; readonly roles: Readonly<Record<string, unknown>> }>(tx, 'connections', (connection) => {
      const pluginId = qualifiedIdOf(connection.pluginId, connection.roles);
      return pluginId === connection.pluginId ? undefined : { ...connection, pluginId };
    });
    rewriteEach<{ readonly key: string; readonly value: Readonly<Record<string, unknown>> }>(tx, 'deviceSettings', (setting) =>
      setting.key === 'plugins' ? { ...setting, value: qualifiedPluginStates(setting.value) } : undefined,
    );
  },
  // One account per device, local or on your own server: as SQLite's v4.
  (db, tx) => {
    db.deleteObjectStore('syncState');
    db.createObjectStore('account', { keyPath: 'key' });
    db.createObjectStore('backupState', { keyPath: 'connectionId' });
    const stale = tx.objectStore('staleSecrets');
    const queue = (ref: unknown) => {
      if (typeof ref === 'string') stale.put({ ref });
    };
    const reading = tx.objectStore('users').getAllKeys();
    reading.onsuccess = () => {
      const users = reading.result.map(String);
      rewriteEach<{ readonly id: string; readonly pluginId: string; readonly roles?: Readonly<Record<string, unknown>>; readonly values?: { readonly credentialsRef?: string } }>(
        tx,
        'connections',
        (connection) => {
          if (connection.pluginId.startsWith('sync/')) {
            // Phase 4's account goes, with its profile values, its saved media and every secret it held.
            queue(connection.values?.credentialsRef);
            for (const scope of ['shared', 'account', ...users]) queue(sessionRefOf(connection.id, scope));
            for (const name of ['connectionProfileValues', 'mediaLists', 'mediaDetails'] as const) {
              rewriteEach<{ readonly values?: { readonly credentialsRef?: string } }>(tx, name, (row) => {
                if (name === 'connectionProfileValues') queue(row.values?.credentialsRef);
                return null;
              }, connection.id);
            }
            return null;
          }
          const { roles, ...rest } = connection;
          return { ...rest, enabled: roles?.media !== false };
        },
      );
    };
    rewriteEach<{ readonly key: string }>(tx, 'deviceSettings', (setting) => (setting.key === 'plugins' || setting.key === 'leftAccountAt' ? null : undefined));
    tx.objectStore('journal').clear();
  },
  // Watch status and its outbox: as SQLite's v5.
  (db) => {
    const watch = db.createObjectStore('watchStatus', { keyPath: ['userId', 'connectionId', 'externalId'] });
    watch.createIndex('byUser', 'userId');
    watch.createIndex('byConnection', 'connectionId');
    watch.createIndex('byUpdatedAt', 'updatedAt');
    const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    outbox.createIndex('byUser', 'userId');
    outbox.createIndex('byConnection', 'connectionId');
    outbox.createIndex('byItem', ['userId', 'connectionId', 'externalId']);
  },

  // Files kept on this device: as SQLite's v6. One row per item per profile,
  // which `byItem` enforces by being the thing the repository looks up before
  // it writes — IndexedDB has no unique index on a non-key path.
  (db) => {
    const downloads = db.createObjectStore('downloads', { keyPath: 'id' });
    downloads.createIndex('byUser', 'userId');
    downloads.createIndex('byConnection', 'connectionId');
    downloads.createIndex('byItem', ['userId', 'connectionId', 'externalId'], { unique: true });
    downloads.createIndex('byState', 'state');
  },

  // A profile's own lists: as SQLite's v7.
  (db) => {
    const subscriptions = db.createObjectStore('subscriptions', { keyPath: 'id' });
    subscriptions.createIndex('byUser', 'userId');
    subscriptions.createIndex('byConnection', 'connectionId');
    subscriptions.createIndex('byChannel', ['userId', 'connectionId', 'externalId'], { unique: true });
    const playlists = db.createObjectStore('playlists', { keyPath: 'id' });
    playlists.createIndex('byUser', 'userId');
  },

  // Favourite channels: as SQLite's v8.
  (db) => {
    const favorites = db.createObjectStore('favoriteChannels', { keyPath: 'id' });
    favorites.createIndex('byUser', 'userId');
    favorites.createIndex('byConnection', 'connectionId');
    favorites.createIndex('byChannel', ['userId', 'connectionId', 'externalId'], { unique: true });
  },

  // Watch progress the app keeps, and the account's own settings: as SQLite's v9.
  (db) => {
    db.createObjectStore('watchProgress', { keyPath: 'id' }).createIndex('byUser', 'userId');
    db.createObjectStore('accountSettings', { keyPath: 'name' });
  },

  // What a metadata adapter said an item is: as SQLite's v10.
  (db) => {
    const identities = db.createObjectStore('identities', { keyPath: ['userId', 'connectionId', 'externalId'] });
    identities.createIndex('byUser', 'userId');
    identities.createIndex('byConnection', 'connectionId');
  },
];

/**
 * Rewrites a store's records — or, given `onlyConnection`, the ones of that
 * connection, through its `byConnection` index: each as `change` answers,
 * deleted for `null`, left alone for `undefined`. Each record is read again
 * just before it is written, so a value a cursor read is never written back
 * stale.
 */
function rewriteEach<T>(tx: IDBTransaction, name: StoreName, change: (record: T) => T | null | undefined, onlyConnection?: string): void {
  const store = tx.objectStore(name);
  const walking = onlyConnection === undefined ? store.openKeyCursor() : store.index('byConnection').openKeyCursor(onlyConnection);
  walking.onsuccess = () => {
    const cursor = walking.result;
    if (!cursor) return;
    const key = cursor.primaryKey;
    const reading = store.get(key);
    reading.onsuccess = () => {
      const next = change(reading.result as T);
      if (next === null) store.delete(key);
      else if (next !== undefined) store.put(next);
    };
    cursor.continue();
  };
}

export const INDEXEDDB_VERSION = INDEXEDDB_UPGRADES.length;

/**
 * Runs the upgrades from `from` to the version being opened, inside the
 * version-change transaction the browser opened — one step, as the app opens
 * the database one version at a time.
 */
export function upgradeIndexedDb(
  db: IDBDatabase,
  from: number,
  tx: IDBTransaction,
  upgrades: readonly Upgrade[] = INDEXEDDB_UPGRADES,
): void {
  for (const upgrade of upgrades.slice(from, db.version)) upgrade(db, tx);
}
