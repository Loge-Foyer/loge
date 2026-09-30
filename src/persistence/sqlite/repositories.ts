import {
  connectionId,
  credentialsRef,
  pluginId,
  userId,
  type Connection,
  type ConnectionId,
  type ConnectionValues,
  type GlobalMediaKey,
  type MediaDetail,
  type MediaItem,
  type PerProfile,
  type UserId,
} from '@sc/api';

import type {
  AccountRepository,
  AccountSync,
  ConnectionRepository,
  DeviceSettings,
  DeviceSettingsRepository,
  JournalAnnouncement,
  JournalEntry,
  JournalRepository,
  MediaCacheRepository,
  PreferencesRepository,
  ProfileValues,
  Repositories,
  StaleSecretQueue,
  StoredAccount,
  StoredUser,
  UserPreferences,
  UserRepository,
} from '@/services/ports';
import { accountWide } from '@/services/scope';

import { changedKeys, documentOf, field, sameData } from '../documents';
import { missingRow } from '../errors';
import type { WriteOptions } from '../writes';
import type { SqlExecutor, SqlValue } from './sql';

interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly pin_credential_ref: string | null;
  readonly version: number;
}

interface ValuesRow {
  readonly fields: string;
  readonly settings: string;
  readonly credentials_ref: string | null;
  readonly secret_keys: string | null;
}

interface ConnectionRow extends ValuesRow {
  readonly id: string;
  readonly plugin_id: string;
  readonly label: string;
  readonly enabled: number;
  readonly per_profile: string;
  readonly version: number;
}

interface ProfileValuesRow extends ValuesRow {
  readonly connection_id: string;
  readonly user_id: string;
  readonly off: number;
  readonly version: number;
}

export interface JournalRow {
  readonly seq: number;
  readonly user_id: string | null;
  readonly entity: JournalEntry['entity'];
  readonly entity_id: string;
  readonly operation: JournalEntry['operation'];
  readonly changed_at: number;
  readonly local_version: number;
}

interface AccountRow {
  readonly kind: StoredAccount['kind'];
  readonly id: string;
  readonly name: string;
  readonly connection_id: string | null;
  readonly max_profiles: number | null;
}

interface AccountSyncRow {
  readonly checkpoint: number;
  readonly last_synced_at: number | null;
  readonly held_back: string;
}

const parse = <T>(text: string): T => JSON.parse(text) as T;

function toUser(row: UserRow): StoredUser {
  return {
    id: userId(row.id),
    name: row.name,
    ...(row.pin_credential_ref === null ? {} : { pinCredentialRef: credentialsRef(row.pin_credential_ref) }),
  };
}

function toValues(row: ValuesRow): ConnectionValues {
  return {
    fields: parse(row.fields),
    settings: parse(row.settings),
    ...(row.credentials_ref === null ? {} : { credentialsRef: credentialsRef(row.credentials_ref) }),
    ...(row.secret_keys === null ? {} : { secretKeys: parse<string[]>(row.secret_keys) }),
  };
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: connectionId(row.id),
    pluginId: pluginId(row.plugin_id),
    label: row.label,
    enabled: row.enabled === 1,
    perProfile: row.per_profile as PerProfile,
    values: toValues(row),
  };
}

function toProfileValues(row: ProfileValuesRow): ProfileValues {
  return { ...toValues(row), ...(row.off === 1 ? { off: true as const } : {}) };
}

export function toJournalEntry(row: JournalRow): JournalEntry {
  return {
    seq: row.seq,
    ...(row.user_id === null ? {} : { userId: userId(row.user_id) }),
    entity: row.entity,
    entityId: row.entity_id,
    operation: row.operation,
    changedAt: row.changed_at,
    localVersion: row.local_version,
  };
}

function valueColumns(values: ConnectionValues): SqlValue[] {
  return [
    JSON.stringify(values.fields),
    JSON.stringify(values.settings),
    values.credentialsRef ?? null,
    values.secretKeys === undefined ? null : JSON.stringify(values.secretKeys),
  ];
}

function toAccount(row: AccountRow): StoredAccount {
  return row.kind === 'server' && row.connection_id !== null
    ? { kind: 'server', id: row.id, name: row.name, connectionId: connectionId(row.connection_id), maxProfiles: row.max_profiles ?? 0 }
    : { kind: 'local', id: row.id, name: row.name };
}

/** The repositories over one connection or one open transaction. */
export function sqliteRepositories(sql: SqlExecutor, options: WriteOptions): Repositories {
  const { clock } = options;
  const append = async (change: JournalAnnouncement) => {
    await sql.run('INSERT INTO change_journal (user_id, entity, entity_id, operation, changed_at, local_version) VALUES (?, ?, ?, ?, ?, ?)', [
      change.userId ?? null,
      change.entity,
      change.entityId,
      change.operation,
      clock.now(),
      change.localVersion,
    ]);
    options.onJournaled?.();
  };
  const record = async (change: JournalAnnouncement) => {
    if (options.journaled) await append(change);
  };
  // A sync plugin's connection is the device's own: it never travels, so it is never journaled.
  const recordConnection = async (plugin: string, change: JournalAnnouncement) => {
    if (accountWide(plugin)) await record(change);
  };

  const userRow = (id: UserId) => sql.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  const connectionRow = (id: ConnectionId) => sql.get<ConnectionRow>('SELECT * FROM connections WHERE id = ?', [id]);
  const profileRow = (id: ConnectionId, user: UserId) =>
    sql.get<ProfileValuesRow>('SELECT * FROM connection_profile_values WHERE connection_id = ? AND user_id = ?', [id, user]);

  const users: UserRepository = {
    list: async () => (await sql.all<UserRow>('SELECT * FROM users ORDER BY position')).map(toUser),
    get: async (id) => {
      const row = await userRow(id);
      return row && toUser(row);
    },
    insert: async (user) => {
      await sql.run(
        'INSERT INTO users (id, name, pin_credential_ref, position, version) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM users), 1)',
        [user.id, user.name, user.pinCredentialRef ?? null],
      );
      await record({ userId: user.id, entity: 'user', entityId: user.id, operation: 'upsert', localVersion: 1 });
      if (user.pinCredentialRef) await record({ userId: user.id, entity: 'userPin', entityId: user.id, operation: 'upsert', localVersion: 1 });
    },
    update: async (user) => {
      const row = await userRow(user.id);
      if (!row) throw missingRow('profile', user.id);
      const before = toUser(row);
      if (sameData(before, user)) return;
      const version = row.version + 1;
      await sql.run('UPDATE users SET name = ?, pin_credential_ref = ?, version = ? WHERE id = ?', [
        user.name,
        user.pinCredentialRef ?? null,
        version,
        user.id,
      ]);
      if (before.name !== user.name) {
        await record({ userId: user.id, entity: 'user', entityId: user.id, operation: 'upsert', localVersion: version });
      }
      if (before.pinCredentialRef !== user.pinCredentialRef) {
        await record({ userId: user.id, entity: 'userPin', entityId: user.id, operation: 'upsert', localVersion: version });
      }
    },
    delete: async (id) => {
      const row = await userRow(id);
      if (!row) return;
      // The cascade takes the profile's own values, preferences and saved media with it.
      await sql.run('DELETE FROM users WHERE id = ?', [id]);
      await record({ userId: id, entity: 'user', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
  };

  const connections: ConnectionRepository = {
    list: async () => (await sql.all<ConnectionRow>('SELECT * FROM connections ORDER BY position')).map(toConnection),
    get: async (id) => {
      const row = await connectionRow(id);
      return row && toConnection(row);
    },
    insert: async (connection) => {
      await sql.run(
        `INSERT INTO connections (id, plugin_id, label, enabled, per_profile, fields, settings, credentials_ref, secret_keys, position, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM connections), 1)`,
        [
          connection.id,
          connection.pluginId,
          connection.label,
          connection.enabled ? 1 : 0,
          connection.perProfile,
          ...valueColumns(connection.values),
        ],
      );
      await recordConnection(connection.pluginId, { entity: 'connection', entityId: connection.id, operation: 'upsert', localVersion: 1 });
    },
    update: async (connection) => {
      const row = await connectionRow(connection.id);
      if (!row) throw missingRow('connection', connection.id);
      if (sameData(toConnection(row), connection)) return;
      const version = row.version + 1;
      // An UPDATE, never INSERT OR REPLACE: replacing deletes the row first, and the cascade would take every profile's values with it.
      await sql.run(
        `UPDATE connections SET plugin_id = ?, label = ?, enabled = ?, per_profile = ?, fields = ?, settings = ?, credentials_ref = ?, secret_keys = ?, version = ?
         WHERE id = ?`,
        [
          connection.pluginId,
          connection.label,
          connection.enabled ? 1 : 0,
          connection.perProfile,
          ...valueColumns(connection.values),
          version,
          connection.id,
        ],
      );
      await recordConnection(connection.pluginId, { entity: 'connection', entityId: connection.id, operation: 'upsert', localVersion: version });
    },
    delete: async (id) => {
      const row = await connectionRow(id);
      if (!row) return;
      await sql.run('DELETE FROM connections WHERE id = ?', [id]);
      await recordConnection(row.plugin_id, { entity: 'connection', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
    profileValues: async (id) =>
      new Map(
        (
          await sql.all<ProfileValuesRow>(
            `SELECT v.* FROM connection_profile_values v JOIN users u ON u.id = v.user_id
             WHERE v.connection_id = ? ORDER BY u.position`,
            [id],
          )
        ).map((row) => [userId(row.user_id), toProfileValues(row)]),
      ),
    valuesOfProfile: async (user) =>
      new Map(
        (
          await sql.all<ProfileValuesRow>(
            `SELECT v.* FROM connection_profile_values v JOIN connections c ON c.id = v.connection_id
             WHERE v.user_id = ? ORDER BY c.position`,
            [user],
          )
        ).map((row) => [connectionId(row.connection_id), toProfileValues(row)]),
      ),
    putProfileValues: async (id, user, values) => {
      const row = await profileRow(id, user);
      if (row && sameData(toProfileValues(row), values)) return;
      const version = (row?.version ?? 0) + 1;
      await sql.run(
        `INSERT INTO connection_profile_values (connection_id, user_id, off, fields, settings, credentials_ref, secret_keys, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, user_id) DO UPDATE SET
           off = excluded.off, fields = excluded.fields, settings = excluded.settings,
           credentials_ref = excluded.credentials_ref, secret_keys = excluded.secret_keys, version = excluded.version`,
        [id, user, values.off ? 1 : 0, ...valueColumns(values), version],
      );
      await recordConnection((await connectionRow(id))?.plugin_id ?? '', {
        userId: user,
        entity: 'connectionProfileValues',
        entityId: `${id}/${user}`,
        operation: 'upsert',
        localVersion: version,
      });
    },
    deleteProfileValues: async (id, user) => {
      const row = await profileRow(id, user);
      if (!row) return;
      await sql.run('DELETE FROM connection_profile_values WHERE connection_id = ? AND user_id = ?', [id, user]);
      await recordConnection((await connectionRow(id))?.plugin_id ?? '', {
        userId: user,
        entity: 'connectionProfileValues',
        entityId: `${id}/${user}`,
        operation: 'delete',
        localVersion: row.version + 1,
      });
    },
  };

  const deviceSettings: DeviceSettingsRepository = {
    get: async () => readDeviceSettings(sql),
    update: async (change) => {
      const current = await readDeviceSettings(sql);
      const next = change(current);
      const { set, removed } = changedKeys(current, next);
      for (const key of removed) await sql.run('DELETE FROM device_settings WHERE key = ?', [key]);
      for (const key of set) {
        await sql.run(
          'INSERT INTO device_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          [key, JSON.stringify(field(next, key))],
        );
      }
      return next;
    },
  };

  const preferences: PreferencesRepository = {
    get: async (user) => readPreferences(sql, user),
    update: async (user, change) => {
      if (!(await userRow(user))) throw missingRow('profile', user);
      const current = await readPreferences(sql, user);
      const next = change(current);
      const { set, removed } = changedKeys(current, next);
      for (const key of removed) {
        const row = await sql.get<{ version: number }>('SELECT version FROM preferences WHERE user_id = ? AND key = ?', [user, key]);
        await sql.run('DELETE FROM preferences WHERE user_id = ? AND key = ?', [user, key]);
        await record({ userId: user, entity: 'preferences', entityId: `${user}/${key}`, operation: 'delete', localVersion: (row?.version ?? 0) + 1 });
      }
      for (const key of set) {
        const row = await sql.get<{ version: number }>('SELECT version FROM preferences WHERE user_id = ? AND key = ?', [user, key]);
        const version = (row?.version ?? 0) + 1;
        await sql.run(
          `INSERT INTO preferences (user_id, key, value, version) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, version = excluded.version`,
          [user, key, JSON.stringify(field(next, key)), version],
        );
        await record({ userId: user, entity: 'preferences', entityId: `${user}/${key}`, operation: 'upsert', localVersion: version });
      }
      return next;
    },
  };

  // A cache write for a profile or connection that is gone would fail its foreign key; it is skipped instead.
  const parentsExist = async (user: UserId, connection: ConnectionId) => {
    const row = await sql.get<{ users: number; connections: number }>(
      'SELECT (SELECT COUNT(*) FROM users WHERE id = ?) AS users, (SELECT COUNT(*) FROM connections WHERE id = ?) AS connections',
      [user, connection],
    );
    return row?.users === 1 && row.connections === 1;
  };

  const mediaCache: MediaCacheRepository = {
    list: async (user, connection, key, fingerprint) => {
      const row = await sql.get<{ items: string; saved_at: number }>(
        'SELECT items, saved_at FROM media_lists WHERE user_id = ? AND connection_id = ? AND list_key = ? AND fingerprint = ?',
        [user, connection, key, fingerprint],
      );
      return row && { items: parse<MediaItem[]>(row.items), savedAt: row.saved_at };
    },
    putList: async (user, connection, key, fingerprint, list) => {
      if (!(await parentsExist(user, connection))) return;
      await sql.run(
        `INSERT INTO media_lists (user_id, connection_id, list_key, fingerprint, items, saved_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, connection_id, list_key) DO UPDATE SET
           fingerprint = excluded.fingerprint, items = excluded.items, saved_at = excluded.saved_at`,
        [user, connection, key, fingerprint, JSON.stringify(list.items), list.savedAt],
      );
    },
    removeList: async (user, connection, key) => {
      await sql.run('DELETE FROM media_lists WHERE user_id = ? AND connection_id = ? AND list_key = ?', [user, connection, key]);
    },
    detail: async (user, key: GlobalMediaKey, fingerprint) => {
      const row = await sql.get<{ detail: string; saved_at: number }>(
        'SELECT detail, saved_at FROM media_details WHERE user_id = ? AND connection_id = ? AND external_id = ? AND fingerprint = ?',
        [user, key.connectionId, key.externalId, fingerprint],
      );
      return row && { detail: parse<MediaDetail>(row.detail), savedAt: row.saved_at };
    },
    putDetail: async (user, fingerprint, saved) => {
      const { connectionId: connection, externalId } = saved.detail.item.key;
      if (!(await parentsExist(user, connection))) return;
      await sql.run(
        `INSERT INTO media_details (user_id, connection_id, external_id, fingerprint, detail, saved_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, connection_id, external_id) DO UPDATE SET
           fingerprint = excluded.fingerprint, detail = excluded.detail, saved_at = excluded.saved_at`,
        [user, connection, externalId, fingerprint, JSON.stringify(saved.detail), saved.savedAt],
      );
    },
    removeDetail: async (user, key) => {
      await sql.run('DELETE FROM media_details WHERE user_id = ? AND connection_id = ? AND external_id = ?', [
        user,
        key.connectionId,
        key.externalId,
      ]);
    },
    purge: async (connection, user) => {
      const where = user === undefined ? 'connection_id = ?' : 'connection_id = ? AND user_id = ?';
      const params = user === undefined ? [connection] : [connection, user];
      await sql.run(`DELETE FROM media_lists WHERE ${where}`, params);
      await sql.run(`DELETE FROM media_details WHERE ${where}`, params);
    },
    prune: async (before, listPrefix) => {
      await sql.run('DELETE FROM media_details WHERE saved_at < ?', [before]);
      await sql.run('DELETE FROM media_lists WHERE saved_at < ? AND substr(list_key, 1, ?) = ?', [before, listPrefix.length, listPrefix]);
    },
  };

  const staleSecrets: StaleSecretQueue = {
    add: async (refs) => {
      for (const ref of refs) await sql.run('INSERT INTO stale_secrets (ref) VALUES (?) ON CONFLICT (ref) DO NOTHING', [ref]);
    },
    list: async () => (await sql.all<{ ref: string }>('SELECT ref FROM stale_secrets')).map((row) => credentialsRef(row.ref)),
    remove: async (refs) => {
      for (const ref of refs) await sql.run('DELETE FROM stale_secrets WHERE ref = ?', [ref]);
    },
  };

  const account: AccountRepository = {
    get: async () => {
      const row = await sql.get<AccountRow>('SELECT * FROM account WHERE singleton = 1');
      return row && toAccount(row);
    },
    put: async (next) => {
      await sql.run(
        `INSERT INTO account (singleton, kind, id, name, connection_id, max_profiles) VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT (singleton) DO UPDATE SET
           kind = excluded.kind, id = excluded.id, name = excluded.name,
           connection_id = excluded.connection_id, max_profiles = excluded.max_profiles`,
        [next.kind, next.id, next.name, next.kind === 'server' ? next.connectionId : null, next.kind === 'server' ? next.maxProfiles : null],
      );
    },
    sync: async (): Promise<AccountSync> => {
      const row = await sql.get<AccountSyncRow>('SELECT * FROM account_sync WHERE singleton = 1');
      if (!row) return { checkpoint: 0, heldBack: [] };
      return {
        checkpoint: row.checkpoint,
        ...(row.last_synced_at === null ? {} : { lastSyncedAt: row.last_synced_at }),
        heldBack: parse<string[]>(row.held_back).map(userId),
      };
    },
    putSync: async (state) => {
      await sql.run(
        `INSERT INTO account_sync (singleton, checkpoint, last_synced_at, held_back) VALUES (1, ?, ?, ?)
         ON CONFLICT (singleton) DO UPDATE SET
           checkpoint = excluded.checkpoint, last_synced_at = excluded.last_synced_at, held_back = excluded.held_back`,
        [state.checkpoint, state.lastSyncedAt ?? null, JSON.stringify(state.heldBack)],
      );
    },
    clear: async () => {
      await sql.run('DELETE FROM account');
      await sql.run('DELETE FROM account_sync');
    },
  };

  const journal: JournalRepository = {
    entries: async (after = 0, limit) =>
      (await sql.all<JournalRow>('SELECT * FROM change_journal WHERE seq > ? ORDER BY seq LIMIT ?', [after, limit ?? -1])).map(
        toJournalEntry,
      ),
    head: async () => (await sql.get<{ head: number }>('SELECT COALESCE(MAX(seq), 0) AS head FROM change_journal'))?.head ?? 0,
    count: async (after) => (await sql.get<{ count: number }>('SELECT COUNT(*) AS count FROM change_journal WHERE seq > ?', [after]))?.count ?? 0,
    announce: async (changes) => {
      for (const change of changes) await append(change);
    },
    prune: async (through) => {
      await sql.run('DELETE FROM change_journal WHERE seq <= ?', [through]);
    },
  };

  return { users, connections, deviceSettings, preferences, mediaCache, staleSecrets, account, journal };
}

async function readDeviceSettings(sql: SqlExecutor): Promise<DeviceSettings> {
  const rows = await sql.all<{ key: string; value: string }>('SELECT key, value FROM device_settings');
  return documentOf<DeviceSettings>(rows.map((row) => [row.key, JSON.parse(row.value) as unknown]));
}

async function readPreferences(sql: SqlExecutor, user: UserId): Promise<UserPreferences> {
  const rows = await sql.all<{ key: string; value: string }>('SELECT key, value FROM preferences WHERE user_id = ?', [user]);
  return documentOf<UserPreferences>(rows.map((row) => [row.key, JSON.parse(row.value) as unknown]));
}
