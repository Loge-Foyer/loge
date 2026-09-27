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
  'syncState',
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
];

export const INDEXEDDB_VERSION = INDEXEDDB_UPGRADES.length;

/** Runs every upgrade after `from`, inside the version-change transaction the browser opened. */
export function upgradeIndexedDb(
  db: IDBDatabase,
  from: number,
  tx: IDBTransaction,
  upgrades: readonly Upgrade[] = INDEXEDDB_UPGRADES,
): void {
  for (const upgrade of upgrades.slice(from)) upgrade(db, tx);
}
