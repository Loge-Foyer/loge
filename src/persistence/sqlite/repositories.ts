import {
  connectionId,
  credentialsRef,
  pluginId,
  userId,
  type AppErrorCode,
  type Connection,
  type ConnectionId,
  type ConnectionValues,
  type GlobalMediaKey,
  type MediaDetail,
  type MediaItem,
  type PerProfile,
  type PlaybackReport,
  type UserId,
  type WatchStatus,
} from '@sc/api';

import type {
  AccountRepository,
  AccountSync,
  BackupState,
  BackupStateRepository,
  ConnectionRepository,
  DeviceSettings,
  DeviceSettingsRepository,
  DownloadEntry,
  DownloadRepository,
  DownloadState,
  JournalAnnouncement,
  JournalEntry,
  JournalRepository,
  MediaCacheRepository,
  OutboxEntry,
  OutboxRepository,
  Playlist,
  PlaylistRepository,
  PreferencesRepository,
  ProfileValues,
  Repositories,
  StaleSecretQueue,
  StoredAccount,
  StoredUser,
  Subscription,
  SubscriptionRepository,
  UserPreferences,
  UserRepository,
  WatchEntry,
  WatchStatusRepository,
} from '@/services/ports';
import { accountWide } from '@/services/scope';
import { itemKeyOf } from '@/services/watch/item-key';

import { changedKeys, documentOf, field, sameData } from '../documents';
import { missingRow } from '../errors';
import { SUPERSEDES } from '../outbox';
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

interface BackupStateRow {
  readonly connection_id: string;
  readonly lineage: string;
  readonly generation: number;
  readonly etag: string | null;
  readonly saved_at: number | null;
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
    // Beside the lists, under keys of their own: the items column holds any JSON.
    value: async <T>(user: UserId, connection: ConnectionId, key: string, fingerprint: string) => {
      const row = await sql.get<{ items: string; saved_at: number }>(
        'SELECT items, saved_at FROM media_lists WHERE user_id = ? AND connection_id = ? AND list_key = ? AND fingerprint = ?',
        [user, connection, key, fingerprint],
      );
      return row && { value: parse<T>(row.items), savedAt: row.saved_at };
    },
    putValue: async (user, connection, key, fingerprint, saved) => {
      if (!(await parentsExist(user, connection))) return;
      await sql.run(
        `INSERT INTO media_lists (user_id, connection_id, list_key, fingerprint, items, saved_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, connection_id, list_key) DO UPDATE SET
           fingerprint = excluded.fingerprint, items = excluded.items, saved_at = excluded.saved_at`,
        [user, connection, key, fingerprint, JSON.stringify(saved.value), saved.savedAt],
      );
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

  const watchStatus: WatchStatusRepository = {
    get: async (user, key) => {
      const row = await sql.get<WatchRow>('SELECT * FROM watch_status WHERE user_id = ? AND connection_id = ? AND external_id = ?', [
        user,
        key.connectionId,
        key.externalId,
      ]);
      return row && toWatchEntry(row);
    },
    list: async (user) =>
      (await sql.all<WatchRow>('SELECT * FROM watch_status WHERE user_id = ? ORDER BY updated_at DESC', [user])).map(toWatchEntry),
    put: async (user, entry) => {
      if (!(await parentsExist(user, entry.key.connectionId))) return;
      await sql.run(
        `INSERT INTO watch_status (user_id, connection_id, external_id, status, item, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, connection_id, external_id) DO UPDATE SET
           status = excluded.status, item = excluded.item, updated_at = excluded.updated_at`,
        [user, entry.key.connectionId, entry.key.externalId, JSON.stringify(entry.status), entry.item ? JSON.stringify(entry.item) : null, entry.updatedAt],
      );
    },
    prune: async (before) => {
      await sql.run(
        `DELETE FROM watch_status WHERE updated_at < ? AND NOT EXISTS (
           SELECT 1 FROM outbox WHERE outbox.user_id = watch_status.user_id
             AND outbox.connection_id = watch_status.connection_id AND outbox.external_id = watch_status.external_id)`,
        [before],
      );
    },
  };

  // Account-wide, so every write is journaled — unlike the downloads below.
  const subscriptions: SubscriptionRepository = {
    list: async (user) =>
      (await sql.all<SubscriptionRow>('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY added_at DESC, id', [user])).map(toSubscription),
    listAll: async () => (await sql.all<SubscriptionRow>('SELECT * FROM subscriptions ORDER BY added_at DESC, id')).map(toSubscription),
    get: async (id) => {
      const row = await sql.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', [id]);
      return row && toSubscription(row);
    },
    forChannel: async (user, connection, external) => {
      const row = await sql.get<SubscriptionRow>(
        'SELECT * FROM subscriptions WHERE user_id = ? AND connection_id = ? AND external_id = ?',
        [user, connection, external],
      );
      return row && toSubscription(row);
    },
    put: async (subscription) => {
      await sql.run(
        `INSERT INTO subscriptions (id, user_id, connection_id, external_id, title, added_at, version) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, added_at = excluded.added_at, version = excluded.version`,
        [
          subscription.id,
          subscription.userId,
          subscription.connectionId,
          subscription.externalId,
          subscription.title,
          subscription.addedAt,
          subscription.version,
        ],
      );
      await record({
        userId: subscription.userId,
        entity: 'subscription',
        entityId: subscription.id,
        operation: 'upsert',
        localVersion: subscription.version,
      });
    },
    remove: async (id) => {
      const row = await sql.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', [id]);
      if (!row) return;
      await sql.run('DELETE FROM subscriptions WHERE id = ?', [id]);
      await record({ userId: userId(row.user_id), entity: 'subscription', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
  };

  const playlists: PlaylistRepository = {
    list: async (user) =>
      (await sql.all<PlaylistRow>('SELECT * FROM playlists WHERE user_id = ? ORDER BY updated_at DESC, id', [user])).map(toPlaylist),
    listAll: async () => (await sql.all<PlaylistRow>('SELECT * FROM playlists ORDER BY updated_at DESC, id')).map(toPlaylist),
    get: async (id) => {
      const row = await sql.get<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [id]);
      return row && toPlaylist(row);
    },
    put: async (playlist) => {
      await sql.run(
        `INSERT INTO playlists (id, user_id, title, description, items, source_connection_id, source_external_id, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title, description = excluded.description, items = excluded.items,
           source_connection_id = excluded.source_connection_id, source_external_id = excluded.source_external_id,
           updated_at = excluded.updated_at, version = excluded.version`,
        [
          playlist.id,
          playlist.userId,
          playlist.title,
          playlist.description ?? null,
          JSON.stringify(playlist.items),
          playlist.source?.connectionId ?? null,
          playlist.source?.externalId ?? null,
          playlist.createdAt,
          playlist.updatedAt,
          playlist.version,
        ],
      );
      await record({ userId: playlist.userId, entity: 'playlist', entityId: playlist.id, operation: 'upsert', localVersion: playlist.version });
    },
    remove: async (id) => {
      const row = await sql.get<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [id]);
      if (!row) return;
      await sql.run('DELETE FROM playlists WHERE id = ?', [id]);
      await record({ userId: userId(row.user_id), entity: 'playlist', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
  };

  const downloads: DownloadRepository = {
    get: async (id) => {
      const row = await sql.get<DownloadRow>('SELECT * FROM downloads WHERE id = ?', [id]);
      return row && toDownloadEntry(row);
    },
    forItem: async (user, key) => {
      const row = await sql.get<DownloadRow>('SELECT * FROM downloads WHERE user_id = ? AND connection_id = ? AND external_id = ?', [
        user,
        key.connectionId,
        key.externalId,
      ]);
      return row && toDownloadEntry(row);
    },
    list: async (user) =>
      (await sql.all<DownloadRow>('SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC', [user])).map(toDownloadEntry),
    listAll: async () => (await sql.all<DownloadRow>('SELECT * FROM downloads ORDER BY created_at DESC')).map(toDownloadEntry),
    put: async (entry) => {
      if (!(await parentsExist(entry.userId, entry.key.connectionId))) return;
      await sql.run(
        `INSERT INTO downloads (id, user_id, connection_id, external_id, state, option_id, item, file_name, container, bytes_total, bytes_done, error_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           state = excluded.state, option_id = excluded.option_id, item = excluded.item, file_name = excluded.file_name,
           container = excluded.container, bytes_total = excluded.bytes_total, bytes_done = excluded.bytes_done,
           error_code = excluded.error_code, updated_at = excluded.updated_at`,
        [
          entry.id,
          entry.userId,
          entry.key.connectionId,
          entry.key.externalId,
          entry.state,
          entry.optionId ?? null,
          JSON.stringify(entry.item),
          entry.fileName,
          entry.container,
          entry.bytesTotal ?? null,
          entry.bytesDone,
          entry.errorCode ?? null,
          entry.createdAt,
          entry.updatedAt,
        ],
      );
    },
    remove: async (id) => {
      await sql.run('DELETE FROM downloads WHERE id = ?', [id]);
    },
  };

  const outbox: OutboxRepository = {
    add: async (user, report) => {
      const { connectionId: connection, externalId } = report.key;
      if (!(await parentsExist(user, connection))) return;
      const superseded = SUPERSEDES[report.kind];
      if (superseded.length > 0) {
        await sql.run(
          `DELETE FROM outbox WHERE user_id = ? AND connection_id = ? AND external_id = ? AND kind IN (${superseded.map(() => '?').join(', ')})`,
          [user, connection, externalId, ...superseded],
        );
      }
      await sql.run(
        'INSERT INTO outbox (user_id, connection_id, external_id, kind, report, created_at, attempts, not_before) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)',
        [user, connection, externalId, report.kind, JSON.stringify(report), clock.now()],
      );
    },
    list: async () => (await sql.all<OutboxRow>('SELECT * FROM outbox ORDER BY seq')).map(toOutboxEntry),
    pendingKeys: async (user) =>
      new Set(
        (await sql.all<{ connection_id: string; external_id: string }>('SELECT DISTINCT connection_id, external_id FROM outbox WHERE user_id = ?', [user])).map(
          (row) => itemKeyOf({ connectionId: connectionId(row.connection_id), externalId: row.external_id }),
        ),
      ),
    remove: async (seq) => {
      await sql.run('DELETE FROM outbox WHERE seq = ?', [seq]);
    },
    defer: async (seq, attempts, notBefore) => {
      await sql.run('UPDATE outbox SET attempts = ?, not_before = ? WHERE seq = ?', [attempts, notBefore, seq]);
    },
    clear: async () => {
      await sql.run('DELETE FROM outbox');
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

  // Device state, like the account's own rows: never journaled.
  const backupState: BackupStateRepository = {
    get: async (id) => {
      const row = await sql.get<BackupStateRow>('SELECT * FROM backup_state WHERE connection_id = ?', [id]);
      return (
        row && {
          connectionId: connectionId(row.connection_id),
          lineage: row.lineage,
          generation: row.generation,
          ...(row.etag === null ? {} : { etag: row.etag }),
          ...(row.saved_at === null ? {} : { savedAt: row.saved_at }),
        }
      );
    },
    put: async (state: BackupState) => {
      if (!(await connectionRow(state.connectionId))) throw missingRow('connection', state.connectionId);
      await sql.run(
        `INSERT INTO backup_state (connection_id, lineage, generation, etag, saved_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (connection_id) DO UPDATE SET
           lineage = excluded.lineage, generation = excluded.generation, etag = excluded.etag, saved_at = excluded.saved_at`,
        [state.connectionId, state.lineage, state.generation, state.etag ?? null, state.savedAt ?? null],
      );
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

  return { users, connections, deviceSettings, preferences, mediaCache, staleSecrets, account, backupState, watchStatus, outbox, downloads, subscriptions, playlists, journal };
}

interface WatchRow {
  readonly user_id: string;
  readonly connection_id: string;
  readonly external_id: string;
  readonly status: string;
  readonly item: string | null;
  readonly updated_at: number;
}

function toWatchEntry(row: WatchRow): WatchEntry {
  return {
    key: { connectionId: connectionId(row.connection_id), externalId: row.external_id },
    status: parse<WatchStatus>(row.status),
    ...(row.item === null ? {} : { item: parse<MediaItem>(row.item) }),
    updatedAt: row.updated_at,
  };
}

interface SubscriptionRow {
  readonly id: string;
  readonly user_id: string;
  readonly connection_id: string;
  readonly external_id: string;
  readonly title: string;
  readonly added_at: string;
  readonly version: number;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: userId(row.user_id),
    connectionId: connectionId(row.connection_id),
    externalId: row.external_id,
    title: row.title,
    addedAt: row.added_at,
    version: row.version,
  };
}

interface PlaylistRow {
  readonly id: string;
  readonly user_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly items: string;
  readonly source_connection_id: string | null;
  readonly source_external_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
}

function toPlaylist(row: PlaylistRow): Playlist {
  const source =
    row.source_connection_id === null || row.source_external_id === null
      ? undefined
      : { connectionId: connectionId(row.source_connection_id), externalId: row.source_external_id };
  return {
    id: row.id,
    userId: userId(row.user_id),
    title: row.title,
    ...(row.description === null ? {} : { description: row.description }),
    items: parse<GlobalMediaKey[]>(row.items),
    ...(source === undefined ? {} : { source }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

interface DownloadRow {
  readonly id: string;
  readonly user_id: string;
  readonly connection_id: string;
  readonly external_id: string;
  readonly state: string;
  readonly option_id: string | null;
  readonly item: string;
  readonly file_name: string;
  readonly container: string;
  readonly bytes_total: number | null;
  readonly bytes_done: number;
  readonly error_code: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

function toDownloadEntry(row: DownloadRow): DownloadEntry {
  return {
    id: row.id,
    userId: userId(row.user_id),
    key: { connectionId: connectionId(row.connection_id), externalId: row.external_id },
    state: row.state as DownloadState,
    ...(row.option_id === null ? {} : { optionId: row.option_id }),
    item: parse<MediaItem>(row.item),
    fileName: row.file_name,
    container: row.container,
    ...(row.bytes_total === null ? {} : { bytesTotal: row.bytes_total }),
    bytesDone: row.bytes_done,
    ...(row.error_code === null ? {} : { errorCode: row.error_code as AppErrorCode }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface OutboxRow {
  readonly seq: number;
  readonly user_id: string;
  readonly report: string;
  readonly created_at: number;
  readonly attempts: number;
  readonly not_before: number | null;
}

function toOutboxEntry(row: OutboxRow): OutboxEntry {
  return {
    seq: row.seq,
    userId: userId(row.user_id),
    report: parse<PlaybackReport>(row.report),
    createdAt: row.created_at,
    attempts: row.attempts,
    ...(row.not_before === null ? {} : { notBefore: row.not_before }),
  };
}

async function readDeviceSettings(sql: SqlExecutor): Promise<DeviceSettings> {
  const rows = await sql.all<{ key: string; value: string }>('SELECT key, value FROM device_settings');
  return documentOf<DeviceSettings>(rows.map((row) => [row.key, JSON.parse(row.value) as unknown]));
}

async function readPreferences(sql: SqlExecutor, user: UserId): Promise<UserPreferences> {
  const rows = await sql.all<{ key: string; value: string }>('SELECT key, value FROM preferences WHERE user_id = ?', [user]);
  return documentOf<UserPreferences>(rows.map((row) => [row.key, JSON.parse(row.value) as unknown]));
}
