import type { AppErrorCode, Connection, ConnectionId, CredentialsRef, ExternalIds, MediaDetail, MediaItem, PlaybackReport, UserId, WatchStatus } from '@loge/api';

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
  Playlist,
  PlaylistRepository,
  Subscription,
  SubscriptionRepository,
  FavoriteChannel,
  FavoriteChannelRepository,
  IdentityRepository,
  KnownIdentity,
  AccountSetting,
  AccountSettingsRepository,
  WatchProgress,
  WatchProgressRepository,
  JournalAnnouncement,
  JournalEntry,
  JournalRepository,
  MediaCacheRepository,
  OutboxEntry,
  OutboxRepository,
  PreferencesRepository,
  ProfileValues,
  Repositories,
  StaleSecretQueue,
  StoredAccount,
  StoredUser,
  UserPreferences,
  UserRepository,
  WatchStatusRepository,
} from '@/services/ports';
import { accountWide } from '@/services/scope';
import { itemKeyOf } from '@/services/watch/item-key';

import { changedKeys, documentOf, field, sameData } from '../documents';
import { missingRow } from '../errors';
import { SUPERSEDES } from '../outbox';
import type { WriteOptions } from '../writes';
import { request, walk, type IndexedDbEnvironment } from './idb';
import type { StoreName } from './migrations';

interface Ordered {
  readonly position: number;
  readonly version: number;
}

type UserRecord = StoredUser & Ordered;
type ConnectionRecord = Connection & Ordered;

interface ProfileValuesRecord {
  readonly connectionId: ConnectionId;
  readonly userId: UserId;
  readonly values: ProfileValues;
  readonly version: number;
}

interface PreferenceRecord {
  readonly userId: UserId;
  readonly key: string;
  readonly value: unknown;
  readonly version: number;
}

interface MediaListRecord {
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly listKey: string;
  readonly fingerprint: string;
  /** A list of items — or, under a key of its own, any other saved answer. */
  readonly items: unknown;
  readonly savedAt: number;
}

interface MediaDetailRecord {
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly externalId: string;
  readonly fingerprint: string;
  readonly detail: MediaDetail;
  readonly savedAt: number;
}

interface IdentityRecord {
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly externalId: string;
  readonly externalIds?: ExternalIds;
  readonly resolvedAt: number;
}

interface WatchRecord {
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly externalId: string;
  readonly status: WatchStatus;
  readonly item?: MediaItem;
  readonly updatedAt: number;
}

/** Newest first, with the id breaking a tie so the order is total. */
const byAdded = (a: { readonly addedAt: string; readonly id: string }, b: { readonly addedAt: string; readonly id: string }) =>
  b.addedAt.localeCompare(a.addedAt) || a.id.localeCompare(b.id);
const byUpdated = (a: { readonly updatedAt: string; readonly id: string }, b: { readonly updatedAt: string; readonly id: string }) =>
  b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);

interface DownloadRecord {
  readonly id: string;
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly externalId: string;
  readonly state: DownloadState;
  readonly optionId?: string;
  readonly item: MediaItem;
  readonly fileName: string;
  readonly container: string;
  readonly bytesTotal?: number;
  readonly bytesDone: number;
  readonly errorCode?: AppErrorCode;
  readonly createdAt: number;
  readonly updatedAt: number;
}

function toDownloadEntry(row: DownloadRecord): DownloadEntry {
  return {
    id: row.id,
    userId: row.userId,
    key: { connectionId: row.connectionId, externalId: row.externalId },
    state: row.state,
    ...(row.optionId === undefined ? {} : { optionId: row.optionId }),
    item: row.item,
    fileName: row.fileName,
    container: row.container,
    ...(row.bytesTotal === undefined ? {} : { bytesTotal: row.bytesTotal }),
    bytesDone: row.bytesDone,
    ...(row.errorCode === undefined ? {} : { errorCode: row.errorCode }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface OutboxRecord {
  readonly seq?: number;
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly externalId: string;
  readonly kind: PlaybackReport['kind'];
  readonly report: PlaybackReport;
  readonly createdAt: number;
  readonly attempts: number;
  readonly notBefore?: number;
}

function toUser({ position: _position, version: _version, ...user }: UserRecord): StoredUser {
  return user;
}

function toConnection({ position: _position, version: _version, ...connection }: ConnectionRecord): Connection {
  return connection;
}

/** The repositories over one open transaction, which spans every store. */
export function indexedDbRepositories(tx: IDBTransaction, deps: WriteOptions & { readonly env: IndexedDbEnvironment }): Repositories {
  const { clock, env } = deps;
  const store = (name: StoreName) => tx.objectStore(name);

  const append = async (change: JournalAnnouncement) => {
    await request(store('journal').add({ ...change, changedAt: clock.now() } satisfies Omit<JournalEntry, 'seq'>));
    deps.onJournaled?.();
  };
  const record = async (change: JournalAnnouncement) => {
    if (deps.journaled) await append(change);
  };
  // A sync plugin's connection is the device's own: it never travels, so it is never journaled.
  const recordConnection = async (plugin: string, change: JournalAnnouncement) => {
    if (accountWide(plugin)) await record(change);
  };

  const get = <T>(name: StoreName, key: IDBValidKey) => request(store(name).get(key) as IDBRequest<T | undefined>);

  const nextPosition = async (name: 'users' | 'connections') => {
    const last = await request(store(name).index('byPosition').openCursor(null, 'prev'));
    return ((last?.value as Ordered | undefined)?.position ?? 0) + 1;
  };

  /** What IndexedDB has no foreign keys to do: take a parent's rows along with it. */
  const deleteWhere = async (name: StoreName, index: 'byUser' | 'byConnection', key: string) => {
    const keys = await request(store(name).index(index).getAllKeys(key));
    for (const primary of keys) await request(store(name).delete(primary));
  };

  const users: UserRepository = {
    list: async () => (await request(store('users').index('byPosition').getAll() as IDBRequest<UserRecord[]>)).map(toUser),
    get: async (id) => {
      const row = await get<UserRecord>('users', id);
      return row && toUser(row);
    },
    insert: async (user) => {
      await request(store('users').add({ ...user, position: await nextPosition('users'), version: 1 } satisfies UserRecord));
      await record({ userId: user.id, entity: 'user', entityId: user.id, operation: 'upsert', localVersion: 1 });
      if (user.pinCredentialRef) await record({ userId: user.id, entity: 'userPin', entityId: user.id, operation: 'upsert', localVersion: 1 });
    },
    update: async (user) => {
      const row = await get<UserRecord>('users', user.id);
      if (!row) throw missingRow('profile', user.id);
      const before = toUser(row);
      if (sameData(before, user)) return;
      const version = row.version + 1;
      await request(store('users').put({ ...user, position: row.position, version } satisfies UserRecord));
      if (before.name !== user.name) {
        await record({ userId: user.id, entity: 'user', entityId: user.id, operation: 'upsert', localVersion: version });
      }
      if (before.pinCredentialRef !== user.pinCredentialRef) {
        await record({ userId: user.id, entity: 'userPin', entityId: user.id, operation: 'upsert', localVersion: version });
      }
    },
    delete: async (id) => {
      const row = await get<UserRecord>('users', id);
      if (!row) return;
      await request(store('users').delete(id));
      for (const name of [
        'connectionProfileValues',
        'preferences',
        'mediaLists',
        'mediaDetails',
        'watchStatus',
        'outbox',
        'downloads',
        'subscriptions',
        'favoriteChannels',
        'playlists',
        'watchProgress',
        'identities',
      ] as const) {
        await deleteWhere(name, 'byUser', id);
      }
      await record({ userId: id, entity: 'user', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
  };

  const byPosition = async <T extends { readonly id: string }>(name: 'users' | 'connections') =>
    new Map((await request(store(name).index('byPosition').getAll() as IDBRequest<(T & Ordered)[]>)).map((row) => [row.id, row.position]));

  const connections: ConnectionRepository = {
    list: async () =>
      (await request(store('connections').index('byPosition').getAll() as IDBRequest<ConnectionRecord[]>)).map(toConnection),
    get: async (id) => {
      const row = await get<ConnectionRecord>('connections', id);
      return row && toConnection(row);
    },
    insert: async (connection) => {
      await request(
        store('connections').add({ ...connection, position: await nextPosition('connections'), version: 1 } satisfies ConnectionRecord),
      );
      await recordConnection(connection.pluginId, { entity: 'connection', entityId: connection.id, operation: 'upsert', localVersion: 1 });
    },
    update: async (connection) => {
      const row = await get<ConnectionRecord>('connections', connection.id);
      if (!row) throw missingRow('connection', connection.id);
      if (sameData(toConnection(row), connection)) return;
      const version = row.version + 1;
      await request(store('connections').put({ ...connection, position: row.position, version } satisfies ConnectionRecord));
      await recordConnection(connection.pluginId, { entity: 'connection', entityId: connection.id, operation: 'upsert', localVersion: version });
    },
    delete: async (id) => {
      const row = await get<ConnectionRecord>('connections', id);
      if (!row) return;
      await request(store('connections').delete(id));
      for (const name of [
        'connectionProfileValues',
        'mediaLists',
        'mediaDetails',
        'watchStatus',
        'outbox',
        'downloads',
        'subscriptions',
        'favoriteChannels',
        'identities',
      ] as const) {
        await deleteWhere(name, 'byConnection', id);
      }
      await request(store('backupState').delete(id));
      await recordConnection(row.pluginId, { entity: 'connection', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
    profileValues: async (id) => {
      const rows = await request(store('connectionProfileValues').index('byConnection').getAll(id) as IDBRequest<ProfileValuesRecord[]>);
      const order = await byPosition('users');
      return new Map(
        [...rows]
          .sort((a, b) => (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0))
          .map((row) => [row.userId, row.values]),
      );
    },
    valuesOfProfile: async (user) => {
      const rows = await request(store('connectionProfileValues').index('byUser').getAll(user) as IDBRequest<ProfileValuesRecord[]>);
      const order = await byPosition('connections');
      return new Map(
        [...rows]
          .sort((a, b) => (order.get(a.connectionId) ?? 0) - (order.get(b.connectionId) ?? 0))
          .map((row) => [row.connectionId, row.values]),
      );
    },
    putProfileValues: async (id, user, values) => {
      const connection = await get<ConnectionRecord>('connections', id);
      if (!connection) throw missingRow('connection', id);
      if (!(await get('users', user))) throw missingRow('profile', user);
      const row = await get<ProfileValuesRecord>('connectionProfileValues', [id, user]);
      if (row && sameData(row.values, values)) return;
      const version = (row?.version ?? 0) + 1;
      await request(store('connectionProfileValues').put({ connectionId: id, userId: user, values, version } satisfies ProfileValuesRecord));
      await recordConnection(connection.pluginId, {
        userId: user,
        entity: 'connectionProfileValues',
        entityId: `${id}/${user}`,
        operation: 'upsert',
        localVersion: version,
      });
    },
    deleteProfileValues: async (id, user) => {
      const row = await get<ProfileValuesRecord>('connectionProfileValues', [id, user]);
      if (!row) return;
      await request(store('connectionProfileValues').delete([id, user]));
      await recordConnection((await get<ConnectionRecord>('connections', id))?.pluginId ?? '', {
        userId: user,
        entity: 'connectionProfileValues',
        entityId: `${id}/${user}`,
        operation: 'delete',
        localVersion: row.version + 1,
      });
    },
  };

  const readDeviceSettings = async () =>
    documentOf<DeviceSettings>(
      (await request(store('deviceSettings').getAll() as IDBRequest<{ key: string; value: unknown }[]>)).map((row) => [row.key, row.value]),
    );

  const deviceSettings: DeviceSettingsRepository = {
    get: readDeviceSettings,
    update: async (change) => {
      const current = await readDeviceSettings();
      const next = change(current);
      const { set, removed } = changedKeys(current, next);
      for (const key of removed) await request(store('deviceSettings').delete(key));
      for (const key of set) await request(store('deviceSettings').put({ key, value: field(next, key) }));
      return next;
    },
  };

  const preferenceRows = (user: UserId) =>
    request(store('preferences').index('byUser').getAll(user) as IDBRequest<PreferenceRecord[]>);

  const preferences: PreferencesRepository = {
    get: async (user) => documentOf<UserPreferences>((await preferenceRows(user)).map((row) => [row.key, row.value])),
    update: async (user, change) => {
      if (!(await get('users', user))) throw missingRow('profile', user);
      const rows = await preferenceRows(user);
      const current = documentOf<UserPreferences>(rows.map((row) => [row.key, row.value]));
      const versions = new Map(rows.map((row) => [row.key, row.version]));
      const next = change(current);
      const { set, removed } = changedKeys(current, next);
      for (const key of removed) {
        await request(store('preferences').delete([user, key]));
        await record({ userId: user, entity: 'preferences', entityId: `${user}/${key}`, operation: 'delete', localVersion: (versions.get(key) ?? 0) + 1 });
      }
      for (const key of set) {
        const version = (versions.get(key) ?? 0) + 1;
        await request(store('preferences').put({ userId: user, key, value: field(next, key), version } satisfies PreferenceRecord));
        await record({ userId: user, entity: 'preferences', entityId: `${user}/${key}`, operation: 'upsert', localVersion: version });
      }
      return next;
    },
  };

  // No foreign keys to refuse a write for a profile or connection that is gone: check, in the same transaction.
  const parentsExist = async (user: UserId, connection: ConnectionId) =>
    (await get('users', user)) !== undefined && (await get('connections', connection)) !== undefined;

  const mediaCache: MediaCacheRepository = {
    list: async (user, connection, key, fingerprint) => {
      const row = await get<MediaListRecord>('mediaLists', [user, connection, key]);
      return row?.fingerprint === fingerprint ? { items: row.items as readonly MediaItem[], savedAt: row.savedAt } : undefined;
    },
    putList: async (user, connection, key, fingerprint, list) => {
      if (!(await parentsExist(user, connection))) return;
      await request(
        store('mediaLists').put({
          userId: user,
          connectionId: connection,
          listKey: key,
          fingerprint,
          items: list.items,
          savedAt: list.savedAt,
        } satisfies MediaListRecord),
      );
    },
    removeList: async (user, connection, key) => {
      await request(store('mediaLists').delete([user, connection, key]));
    },
    detail: async (user, key, fingerprint) => {
      const row = await get<MediaDetailRecord>('mediaDetails', [user, key.connectionId, key.externalId]);
      return row?.fingerprint === fingerprint ? { detail: row.detail, savedAt: row.savedAt } : undefined;
    },
    putDetail: async (user, fingerprint, saved) => {
      const { connectionId: connection, externalId } = saved.detail.item.key;
      if (!(await parentsExist(user, connection))) return;
      await request(
        store('mediaDetails').put({
          userId: user,
          connectionId: connection,
          externalId,
          fingerprint,
          detail: saved.detail,
          savedAt: saved.savedAt,
        } satisfies MediaDetailRecord),
      );
    },
    removeDetail: async (user, key) => {
      await request(store('mediaDetails').delete([user, key.connectionId, key.externalId]));
    },
    value: async <T>(user: UserId, connection: ConnectionId, key: string, fingerprint: string) => {
      const row = await get<MediaListRecord>('mediaLists', [user, connection, key]);
      return row?.fingerprint === fingerprint ? { value: row.items as T, savedAt: row.savedAt } : undefined;
    },
    putValue: async (user, connection, key, fingerprint, saved) => {
      if (!(await parentsExist(user, connection))) return;
      await request(
        store('mediaLists').put({
          userId: user,
          connectionId: connection,
          listKey: key,
          fingerprint,
          items: saved.value,
          savedAt: saved.savedAt,
        } satisfies MediaListRecord),
      );
    },
    purge: async (connection, user) => {
      for (const name of ['mediaLists', 'mediaDetails'] as const) {
        const keys = await request(store(name).index('byConnection').getAllKeys(connection));
        for (const key of keys) {
          // The primary key starts with the profile it was saved for.
          if (user === undefined || (Array.isArray(key) && key[0] === user)) await request(store(name).delete(key));
        }
      }
    },
    prune: async (before, listPrefix) => {
      const older = env.IDBKeyRange.upperBound(before, true);
      await walk(store('mediaDetails').index('bySavedAt').openCursor(older), (cursor) => {
        cursor.delete();
        return true;
      });
      await walk(store('mediaLists').index('bySavedAt').openCursor(older), (cursor) => {
        if ((cursor.value as MediaListRecord).listKey.startsWith(listPrefix)) cursor.delete();
        return true;
      });
    },
  };

  const watchStatus: WatchStatusRepository = {
    get: async (user, key) => {
      const row = await get<WatchRecord>('watchStatus', [user, key.connectionId, key.externalId]);
      return row && toWatchEntry(row);
    },
    list: async (user) =>
      (await request(store('watchStatus').index('byUser').getAll(user) as IDBRequest<WatchRecord[]>))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(toWatchEntry),
    put: async (user, entry) => {
      if (!(await parentsExist(user, entry.key.connectionId))) return;
      await request(
        store('watchStatus').put({
          userId: user,
          connectionId: entry.key.connectionId,
          externalId: entry.key.externalId,
          status: entry.status,
          ...(entry.item ? { item: entry.item } : {}),
          updatedAt: entry.updatedAt,
        } satisfies WatchRecord),
      );
    },
    prune: async (before) => {
      const rows = await request(store('watchStatus').index('byUpdatedAt').getAll(env.IDBKeyRange.upperBound(before, true)) as IDBRequest<WatchRecord[]>);
      for (const row of rows) {
        const waiting = await request(store('outbox').index('byItem').count([row.userId, row.connectionId, row.externalId]));
        if (waiting === 0) await request(store('watchStatus').delete([row.userId, row.connectionId, row.externalId]));
      }
    },
  };

  const subscriptions: SubscriptionRepository = {
    list: async (user) =>
      (await request(store('subscriptions').index('byUser').getAll(user) as IDBRequest<Subscription[]>)).sort(byAdded),
    listAll: async () => (await request(store('subscriptions').getAll() as IDBRequest<Subscription[]>)).sort(byAdded),
    get: (id) => get<Subscription>('subscriptions', id),
    forChannel: async (user, connection, external) =>
      request(store('subscriptions').index('byChannel').get([user, connection, external]) as IDBRequest<Subscription | undefined>),
    put: async (subscription) => {
      await request(store('subscriptions').put(subscription));
      await record({
        userId: subscription.userId,
        entity: 'subscription',
        entityId: subscription.id,
        operation: 'upsert',
        localVersion: subscription.version,
      });
    },
    remove: async (id) => {
      const row = await get<Subscription>('subscriptions', id);
      if (!row) return;
      await request(store('subscriptions').delete(id));
      await record({ userId: row.userId, entity: 'subscription', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
  };

  const favoriteChannels: FavoriteChannelRepository = {
    list: async (user) =>
      (await request(store('favoriteChannels').index('byUser').getAll(user) as IDBRequest<FavoriteChannel[]>)).sort(byAdded),
    listAll: async () => (await request(store('favoriteChannels').getAll() as IDBRequest<FavoriteChannel[]>)).sort(byAdded),
    get: (id) => get<FavoriteChannel>('favoriteChannels', id),
    forChannel: async (user, connection, external) =>
      request(store('favoriteChannels').index('byChannel').get([user, connection, external]) as IDBRequest<FavoriteChannel | undefined>),
    put: async (favorite) => {
      await request(store('favoriteChannels').put(favorite));
      await record({ userId: favorite.userId, entity: 'favoriteChannel', entityId: favorite.id, operation: 'upsert', localVersion: favorite.version });
    },
    remove: async (id) => {
      const row = await get<FavoriteChannel>('favoriteChannels', id);
      if (!row) return;
      await request(store('favoriteChannels').delete(id));
      await record({ userId: row.userId, entity: 'favoriteChannel', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
  };

  const playlists: PlaylistRepository = {
    list: async (user) => (await request(store('playlists').index('byUser').getAll(user) as IDBRequest<Playlist[]>)).sort(byUpdated),
    listAll: async () => (await request(store('playlists').getAll() as IDBRequest<Playlist[]>)).sort(byUpdated),
    get: (id) => get<Playlist>('playlists', id),
    put: async (playlist) => {
      await request(store('playlists').put(playlist));
      await record({ userId: playlist.userId, entity: 'playlist', entityId: playlist.id, operation: 'upsert', localVersion: playlist.version });
    },
    remove: async (id) => {
      const row = await get<Playlist>('playlists', id);
      if (!row) return;
      await request(store('playlists').delete(id));
      await record({ userId: row.userId, entity: 'playlist', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
  };

  const downloads: DownloadRepository = {
    get: async (id) => {
      const row = await get<DownloadRecord>('downloads', id);
      return row && toDownloadEntry(row);
    },
    forItem: async (user, key) => {
      const row = await request(
        store('downloads').index('byItem').get([user, key.connectionId, key.externalId]) as IDBRequest<DownloadRecord | undefined>,
      );
      return row && toDownloadEntry(row);
    },
    list: async (user) =>
      (await request(store('downloads').index('byUser').getAll(user) as IDBRequest<DownloadRecord[]>))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(toDownloadEntry),
    listAll: async () =>
      (await request(store('downloads').getAll() as IDBRequest<DownloadRecord[]>))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(toDownloadEntry),
    put: async (entry) => {
      if (!(await parentsExist(entry.userId, entry.key.connectionId))) return;
      await request(
        store('downloads').put({
          id: entry.id,
          userId: entry.userId,
          connectionId: entry.key.connectionId,
          externalId: entry.key.externalId,
          state: entry.state,
          ...(entry.optionId === undefined ? {} : { optionId: entry.optionId }),
          item: entry.item,
          fileName: entry.fileName,
          container: entry.container,
          ...(entry.bytesTotal === undefined ? {} : { bytesTotal: entry.bytesTotal }),
          bytesDone: entry.bytesDone,
          ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        } satisfies DownloadRecord),
      );
    },
    remove: async (id) => {
      await request(store('downloads').delete(id));
    },
  };

  const outbox: OutboxRepository = {
    add: async (user, report) => {
      const { connectionId: connection, externalId } = report.key;
      if (!(await parentsExist(user, connection))) return;
      const superseded = SUPERSEDES[report.kind];
      if (superseded.length > 0) {
        const waiting = await request(store('outbox').index('byItem').getAll([user, connection, externalId]) as IDBRequest<OutboxRecord[]>);
        for (const row of waiting) {
          if (row.seq !== undefined && superseded.includes(row.kind)) await request(store('outbox').delete(row.seq));
        }
      }
      await request(
        store('outbox').add({
          userId: user,
          connectionId: connection,
          externalId,
          kind: report.kind,
          report,
          createdAt: clock.now(),
          attempts: 0,
        } satisfies OutboxRecord),
      );
    },
    list: async () => (await request(store('outbox').getAll() as IDBRequest<OutboxRecord[]>)).flatMap((row) => toOutboxEntry(row) ?? []),
    pendingKeys: async (user) =>
      new Set(
        (await request(store('outbox').index('byUser').getAll(user) as IDBRequest<OutboxRecord[]>)).map((row) =>
          itemKeyOf({ connectionId: row.connectionId, externalId: row.externalId }),
        ),
      ),
    remove: async (seq) => {
      await request(store('outbox').delete(seq));
    },
    defer: async (seq, attempts, notBefore) => {
      const row = await get<OutboxRecord>('outbox', seq);
      if (row) await request(store('outbox').put({ ...row, attempts, notBefore } satisfies OutboxRecord));
    },
    clear: async () => {
      await request(store('outbox').clear());
    },
  };

  const staleSecrets: StaleSecretQueue = {
    add: async (refs) => {
      for (const ref of refs) await request(store('staleSecrets').put({ ref }));
    },
    list: async () => (await request(store('staleSecrets').getAll() as IDBRequest<{ ref: CredentialsRef }[]>)).map((row) => row.ref),
    remove: async (refs) => {
      for (const ref of refs) await request(store('staleSecrets').delete(ref));
    },
  };

  const account: AccountRepository = {
    get: async () => (await get<{ readonly account: StoredAccount }>('account', 'account'))?.account,
    put: async (next) => {
      await request(store('account').put({ key: 'account', account: next }));
    },
    sync: async (): Promise<AccountSync> => (await get<{ readonly sync: AccountSync }>('account', 'sync'))?.sync ?? { checkpoint: 0, heldBack: [] },
    putSync: async (state) => {
      await request(store('account').put({ key: 'sync', sync: state }));
    },
    clear: async () => {
      await request(store('account').clear());
    },
  };

  const after = (seq: number) => env.IDBKeyRange.lowerBound(seq, true);
  const journal: JournalRepository = {
    entries: (seq = 0, limit) =>
      request((limit === undefined ? store('journal').getAll(after(seq)) : store('journal').getAll(after(seq), limit)) as IDBRequest<JournalEntry[]>),
    head: async () => {
      const last = await request(store('journal').openKeyCursor(null, 'prev'));
      return typeof last?.primaryKey === 'number' ? last.primaryKey : 0;
    },
    count: (seq) => request(store('journal').count(after(seq))),
    announce: async (changes) => {
      for (const change of changes) await append(change);
    },
    prune: async (through) => {
      await request(store('journal').delete(env.IDBKeyRange.upperBound(through)));
    },
  };

  // Device state, like the account's own records: never journaled.
  const backupState: BackupStateRepository = {
    get: (id) => get<BackupState>('backupState', id),
    put: async (state) => {
      if (!(await get('connections', state.connectionId))) throw missingRow('connection', state.connectionId);
      await request(store('backupState').put({ ...state }));
    },
  };

  // Account-wide, journaled, going with the profile alone.
  const watchProgress: WatchProgressRepository = {
    get: (id) => get<WatchProgress>('watchProgress', id),
    getMany: async (ids) => {
      const found: WatchProgress[] = [];
      for (const id of ids) {
        const row = await get<WatchProgress>('watchProgress', id);
        if (row) found.push(row);
      }
      return found;
    },
    list: async (user) => (await request(store('watchProgress').index('byUser').getAll(user) as IDBRequest<WatchProgress[]>)).sort(byUpdated),
    listAll: async () => (await request(store('watchProgress').getAll() as IDBRequest<WatchProgress[]>)).sort(byUpdated),
    put: async (progress) => {
      // A row whose profile is gone is refused: there is no cascade to take it later.
      if (!(await get('users', progress.userId))) throw missingRow('profile', progress.userId);
      await request(store('watchProgress').put(progress));
      await record({ userId: progress.userId, entity: 'watchProgress', entityId: progress.id, operation: 'upsert', localVersion: progress.version });
    },
    remove: async (id) => {
      const row = await get<WatchProgress>('watchProgress', id);
      if (!row) return;
      await request(store('watchProgress').delete(id));
      await record({ userId: row.userId, entity: 'watchProgress', entityId: id, operation: 'delete', localVersion: row.version + 1 });
    },
  };

  // Device state beside the media cache: never journaled, cascaded by hand from the profile and the connection.
  const identities: IdentityRepository = {
    getMany: async (user, keys) => {
      const found: KnownIdentity[] = [];
      for (const key of keys) {
        const row = await get<IdentityRecord>('identities', [user, key.connectionId, key.externalId]);
        if (!row) continue;
        found.push({ key, ...(row.externalIds ? { externalIds: row.externalIds } : {}), resolvedAt: row.resolvedAt });
      }
      return found;
    },
    put: async (user, known) => {
      if (!(await parentsExist(user, known.key.connectionId))) return;
      await request(
        store('identities').put({
          userId: user,
          connectionId: known.key.connectionId,
          externalId: known.key.externalId,
          ...(known.externalIds ? { externalIds: known.externalIds } : {}),
          resolvedAt: known.resolvedAt,
        } satisfies IdentityRecord),
      );
    },
    purge: async (connection, user) => {
      for (const key of await request(store('identities').index('byConnection').getAllKeys(connection))) {
        // The primary key starts with the profile it was asked for.
        if (user === undefined || (Array.isArray(key) && key[0] === user)) await request(store('identities').delete(key));
      }
    },
  };

  // The account's own, no profile's: journaled with no user.
  const accountSettings: AccountSettingsRepository = {
    get: (name) => get<AccountSetting>('accountSettings', name),
    list: async () => (await request(store('accountSettings').getAll() as IDBRequest<AccountSetting[]>)).sort((a, b) => a.name.localeCompare(b.name)),
    put: async (setting) => {
      const row = await get<AccountSetting>('accountSettings', setting.name);
      if (row && JSON.stringify(row.value) === JSON.stringify(setting.value)) return;
      await request(store('accountSettings').put({ ...setting }));
      await record({ entity: 'accountSetting', entityId: setting.name, operation: 'upsert', localVersion: setting.version });
    },
    remove: async (name) => {
      const row = await get<AccountSetting>('accountSettings', name);
      if (!row) return;
      await request(store('accountSettings').delete(name));
      await record({ entity: 'accountSetting', entityId: name, operation: 'delete', localVersion: row.version + 1 });
    },
    clear: async () => {
      await request(store('accountSettings').clear());
    },
  };

  return {
    users,
    connections,
    deviceSettings,
    preferences,
    mediaCache,
    staleSecrets,
    account,
    backupState,
    watchStatus,
    outbox,
    downloads,
    subscriptions,
    favoriteChannels,
    playlists,
    watchProgress,
    accountSettings,
    identities,
    journal,
  };
}

function toWatchEntry(row: WatchRecord) {
  return {
    key: { connectionId: row.connectionId, externalId: row.externalId },
    status: row.status,
    ...(row.item ? { item: row.item } : {}),
    updatedAt: row.updatedAt,
  };
}

function toOutboxEntry(row: OutboxRecord): OutboxEntry | undefined {
  if (row.seq === undefined) return undefined;
  return {
    seq: row.seq,
    userId: row.userId,
    report: row.report,
    createdAt: row.createdAt,
    attempts: row.attempts,
    ...(row.notBefore === undefined ? {} : { notBefore: row.notBefore }),
  };
}
