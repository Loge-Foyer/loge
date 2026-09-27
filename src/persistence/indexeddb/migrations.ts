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
] as const;

export type StoreName = (typeof STORES)[number];

type Upgrade = (db: IDBDatabase) => void;

// One entry per version, never edited once shipped: version n runs UPGRADES[n - 1].
const UPGRADES: readonly Upgrade[] = [
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
];

export const INDEXEDDB_VERSION = UPGRADES.length;

/** Runs every upgrade after `from`, inside the version-change transaction the browser opened. */
export function upgradeIndexedDb(db: IDBDatabase, from: number, upgrades: readonly Upgrade[] = UPGRADES): void {
  for (const upgrade of upgrades.slice(from)) upgrade(db);
}
