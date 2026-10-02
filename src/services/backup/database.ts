import {
  connectionId as toConnectionId,
  isAccountRecord,
  pluginId as toPluginId,
  userId as toUserId,
  type AccountRecord,
  type PerProfile,
} from '@sc/api';

import type { BackupSql, BackupSqlDatabase } from '../ports';

/**
 * The database inside a backup file: its own schema, versioned, never a copy
 * of the device database. Its rows are the account's records — the shapes
 * your own server keeps — so one mapper serves the server, the upload to a new
 * server account, and backups: a field added to a record is added here once.
 */

/**
 * v2 added a profile's own lists, and v3 its favourite channels. A file at an
 * older version still opens — it simply has none of what came later — so only
 * a *newer* schema is refused, never an older one.
 */
export const BACKUP_SCHEMA_VERSION = 3;
// 'SCBK', so a stray SQLite file is never taken for a backup's database.
const APPLICATION_ID = 0x5343424b;

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;
CREATE TABLE profiles (position INTEGER NOT NULL, user_id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL) STRICT;
CREATE TABLE pins (user_id TEXT PRIMARY KEY NOT NULL, pin TEXT) STRICT;
CREATE TABLE preferences (user_id TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, name)) STRICT;
CREATE TABLE connections (
  position INTEGER NOT NULL,
  connection_id TEXT PRIMARY KEY NOT NULL,
  plugin_id TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  per_profile TEXT NOT NULL,
  fields TEXT NOT NULL,
  settings TEXT NOT NULL,
  secret_keys TEXT NOT NULL,
  secrets TEXT NOT NULL
) STRICT;
CREATE TABLE profile_values (
  connection_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  off INTEGER NOT NULL,
  fields TEXT NOT NULL,
  settings TEXT NOT NULL,
  secret_keys TEXT NOT NULL,
  secrets TEXT NOT NULL,
  PRIMARY KEY (connection_id, user_id)
) STRICT;
CREATE TABLE subscriptions (
  subscription_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  added_at TEXT NOT NULL
) STRICT;
CREATE TABLE favorite_channels (
  favorite_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  number INTEGER,
  logo TEXT,
  added_at TEXT NOT NULL
) STRICT;
CREATE TABLE playlists (
  playlist_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  items TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

/** What a backup holds: the account, as records, and what names it. */
export interface BackupContents {
  /** The account's id: backups of one account share it. */
  readonly lineage: string;
  readonly accountName: string;
  readonly appVersion: string;
  readonly records: readonly AccountRecord[];
}

/** Why a database inside a file cannot be read. */
export type ReadFailure = 'newer' | 'damaged';

type Live<K extends AccountRecord['kind']> = Extract<AccountRecord, { kind: K; deleted: false }>;

const json = (value: unknown) => JSON.stringify(value);

/** The account's records as a new database, serialized. Only live records: a backup holds no tombstones. */
export async function writeBackupDatabase(sql: BackupSql, contents: BackupContents): Promise<Uint8Array> {
  const db = await sql.create();
  try {
    await db.exec(`PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${BACKUP_SCHEMA_VERSION};`);
    await db.exec(SCHEMA);
    await db.exec('BEGIN');
    for (const [key, value] of [
      ['lineage', contents.lineage],
      ['accountName', contents.accountName],
      ['appVersion', contents.appVersion],
    ] as const) {
      await db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value]);
    }
    let position = 0;
    for (const record of contents.records) {
      position += 1;
      if (record.deleted) continue;
      await insert(db, record, position);
    }
    await db.exec('COMMIT');
    return await db.serialize();
  } finally {
    await db.close();
  }
}

async function insert(db: BackupSqlDatabase, record: Extract<AccountRecord, { deleted: false }>, position: number): Promise<void> {
  switch (record.kind) {
    case 'profile':
      return db.run('INSERT INTO profiles (position, user_id, name) VALUES (?, ?, ?)', [position, record.data.userId, record.data.name]);
    case 'pin':
      return db.run('INSERT INTO pins (user_id, pin) VALUES (?, ?)', [record.data.userId, record.data.pin]);
    case 'preference':
      return db.run('INSERT INTO preferences (user_id, name, value) VALUES (?, ?, ?)', [record.data.userId, record.data.name, json(record.data.value)]);
    case 'connection': {
      const { data } = record;
      return db.run(
        `INSERT INTO connections (position, connection_id, plugin_id, label, enabled, per_profile, fields, settings, secret_keys, secrets)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [position, data.connectionId, data.pluginId, data.label, data.enabled ? 1 : 0, data.perProfile, json(data.fields), json(data.settings), json(data.secretKeys), json(data.secrets)],
      );
    }
    case 'profileValues': {
      const { data } = record;
      return db.run(
        `INSERT INTO profile_values (connection_id, user_id, off, fields, settings, secret_keys, secrets) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [data.connectionId, data.userId, data.off ? 1 : 0, json(data.fields), json(data.settings), json(data.secretKeys), json(data.secrets)],
      );
    }
    case 'subscription': {
      const { data } = record;
      return db.run(
        'INSERT INTO subscriptions (subscription_id, user_id, connection_id, external_id, title, added_at) VALUES (?, ?, ?, ?, ?, ?)',
        [data.subscriptionId, data.userId, data.connectionId, data.externalId, data.title, data.addedAt],
      );
    }
    case 'favoriteChannel': {
      const { data } = record;
      return db.run(
        'INSERT INTO favorite_channels (favorite_id, user_id, connection_id, external_id, name, number, logo, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [data.favoriteId, data.userId, data.connectionId, data.externalId, data.name, data.number ?? null, data.logo ?? null, data.addedAt],
      );
    }
    case 'playlist': {
      const { data } = record;
      return db.run(
        'INSERT INTO playlists (playlist_id, user_id, title, description, items, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          data.playlistId,
          data.userId,
          data.title,
          data.description ?? null,
          json(data.items),
          data.source === undefined ? null : json(data.source),
          data.createdAt,
          data.updatedAt,
        ],
      );
    }
  }
}

interface SubscriptionRow {
  readonly subscription_id: string;
  readonly user_id: string;
  readonly connection_id: string;
  readonly external_id: string;
  readonly title: string;
  readonly added_at: string;
}

interface FavoriteChannelRow {
  readonly favorite_id: string;
  readonly user_id: string;
  readonly connection_id: string;
  readonly external_id: string;
  readonly name: string;
  readonly number: number | null;
  readonly logo: string | null;
  readonly added_at: string;
}

interface PlaylistRow {
  readonly playlist_id: string;
  readonly user_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly items: string;
  readonly source: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ConnectionRow {
  readonly connection_id: string;
  readonly plugin_id: string;
  readonly label: string;
  readonly enabled: number;
  readonly per_profile: string;
  readonly fields: string;
  readonly settings: string;
  readonly secret_keys: string;
  readonly secrets: string;
}

interface ValuesRow {
  readonly connection_id: string;
  readonly user_id: string;
  readonly off: number;
  readonly fields: string;
  readonly settings: string;
  readonly secret_keys: string;
  readonly secrets: string;
}

/**
 * The database a file held, checked before anything of it is believed: that
 * it is one, that SQLite finds it sound, that its schema is one this app
 * reads, and that every row is a record the contract allows. One row that is
 * not refuses the whole file: half an account is never imported.
 */
export async function readBackupDatabase(sql: BackupSql, bytes: Uint8Array): Promise<BackupContents | ReadFailure> {
  let db: BackupSqlDatabase;
  try {
    db = await sql.open(bytes);
  } catch {
    return 'damaged';
  }
  try {
    const [check] = await db.all<{ quick_check: string }>('PRAGMA quick_check');
    if (check?.quick_check !== 'ok') return 'damaged';
    const [application] = await db.all<{ application_id: number }>('PRAGMA application_id');
    if (application?.application_id !== APPLICATION_ID) return 'damaged';
    const [version] = await db.all<{ user_version: number }>('PRAGMA user_version');
    if ((version?.user_version ?? 0) > BACKUP_SCHEMA_VERSION) return 'newer';
    // Any version this app ever wrote opens: an older file is read for what
    // it holds. Refusing all but the current one would make every backup
    // unreadable the day the schema next moved on.
    if ((version?.user_version ?? 0) < 1) return 'damaged';

    const meta = new Map((await db.all<{ key: string; value: string }>('SELECT key, value FROM meta')).map((row) => [row.key, row.value]));
    const lineage = meta.get('lineage');
    const accountName = meta.get('accountName');
    if (!lineage || accountName === undefined) return 'damaged';

    const records: AccountRecord[] = [];
    for (const row of await db.all<{ user_id: string; name: string }>('SELECT user_id, name FROM profiles ORDER BY position')) {
      records.push({ kind: 'profile', key: row.user_id, deleted: false, data: { userId: toUserId(row.user_id), name: row.name } } satisfies Live<'profile'>);
    }
    for (const row of await db.all<{ user_id: string; pin: string | null }>('SELECT user_id, pin FROM pins')) {
      records.push({ kind: 'pin', key: row.user_id, deleted: false, data: { userId: toUserId(row.user_id), pin: row.pin } } satisfies Live<'pin'>);
    }
    for (const row of await db.all<{ user_id: string; name: string; value: string }>('SELECT user_id, name, value FROM preferences')) {
      records.push({
        kind: 'preference',
        key: `${row.user_id}/${row.name}`,
        deleted: false,
        data: { userId: toUserId(row.user_id), name: row.name, value: JSON.parse(row.value) as unknown },
      } satisfies Live<'preference'>);
    }
    for (const row of await db.all<ConnectionRow>('SELECT * FROM connections ORDER BY position')) {
      records.push({
        kind: 'connection',
        key: row.connection_id,
        deleted: false,
        data: {
          connectionId: toConnectionId(row.connection_id),
          pluginId: toPluginId(row.plugin_id),
          label: row.label,
          enabled: row.enabled === 1,
          perProfile: row.per_profile as PerProfile,
          fields: JSON.parse(row.fields) as Live<'connection'>['data']['fields'],
          settings: JSON.parse(row.settings) as Live<'connection'>['data']['settings'],
          secretKeys: JSON.parse(row.secret_keys) as readonly string[],
          secrets: JSON.parse(row.secrets) as Live<'connection'>['data']['secrets'],
        },
      } satisfies Live<'connection'>);
    }
    for (const row of await db.all<ValuesRow>('SELECT * FROM profile_values')) {
      records.push({
        kind: 'profileValues',
        key: `${row.connection_id}/${row.user_id}`,
        deleted: false,
        data: {
          connectionId: toConnectionId(row.connection_id),
          userId: toUserId(row.user_id),
          off: row.off === 1,
          fields: JSON.parse(row.fields) as Live<'profileValues'>['data']['fields'],
          settings: JSON.parse(row.settings) as Live<'profileValues'>['data']['settings'],
          secretKeys: JSON.parse(row.secret_keys) as readonly string[],
          secrets: JSON.parse(row.secrets) as Live<'profileValues'>['data']['secrets'],
        },
      } satisfies Live<'profileValues'>);
    }
    // A v1 file has neither table. It is still a backup, and still opens: an
    // older schema is read for what it holds, and only a newer one is refused.
    if ((version?.user_version ?? 0) >= 2) {
      for (const row of await db.all<SubscriptionRow>('SELECT * FROM subscriptions')) {
        records.push({
          kind: 'subscription',
          key: row.subscription_id,
          deleted: false,
          data: {
            subscriptionId: row.subscription_id,
            userId: toUserId(row.user_id),
            connectionId: toConnectionId(row.connection_id),
            externalId: row.external_id,
            title: row.title,
            addedAt: row.added_at,
          },
        } satisfies Live<'subscription'>);
      }
    }
    // A file before v3 has no favourite channels, and opens all the same.
    if ((version?.user_version ?? 0) >= 3) {
      for (const row of await db.all<FavoriteChannelRow>('SELECT * FROM favorite_channels')) {
        records.push({
          kind: 'favoriteChannel',
          key: row.favorite_id,
          deleted: false,
          data: {
            favoriteId: row.favorite_id,
            userId: toUserId(row.user_id),
            connectionId: toConnectionId(row.connection_id),
            externalId: row.external_id,
            name: row.name,
            ...(row.number === null ? {} : { number: row.number }),
            ...(row.logo === null ? {} : { logo: row.logo }),
            addedAt: row.added_at,
          },
        } satisfies Live<'favoriteChannel'>);
      }
    }
    if ((version?.user_version ?? 0) >= 2) {
      for (const row of await db.all<PlaylistRow>('SELECT * FROM playlists')) {
        records.push({
          kind: 'playlist',
          key: row.playlist_id,
          deleted: false,
          data: {
            playlistId: row.playlist_id,
            userId: toUserId(row.user_id),
            title: row.title,
            ...(row.description === null ? {} : { description: row.description }),
            items: JSON.parse(row.items) as Live<'playlist'>['data']['items'],
            ...(row.source === null
              ? {}
              : { source: JSON.parse(row.source) as NonNullable<Live<'playlist'>['data']['source']> }),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        } satisfies Live<'playlist'>);
      }
    }
    // The file came from outside: what the contract refuses, the app never stores.
    if (!records.every(isAccountRecord)) return 'damaged';
    return { lineage, accountName, appVersion: meta.get('appVersion') ?? '', records };
  } catch {
    // A table missing, a column that is not JSON: not a backup this app wrote.
    return 'damaged';
  } finally {
    await db.close();
  }
}
