import type { Connection, ConnectionId, CredentialsRef, MediaDetail, MediaItem, UserId } from '@sc/api';

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
  readonly items: readonly MediaItem[];
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
      for (const name of ['connectionProfileValues', 'preferences', 'mediaLists', 'mediaDetails'] as const) {
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
      for (const name of ['connectionProfileValues', 'mediaLists', 'mediaDetails'] as const) {
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
      return row?.fingerprint === fingerprint ? { items: row.items, savedAt: row.savedAt } : undefined;
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

  return { users, connections, deviceSettings, preferences, mediaCache, staleSecrets, account, journal };
}
