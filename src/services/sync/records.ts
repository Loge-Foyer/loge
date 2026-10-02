import {
  isAccountRecord,
  userId as toUserId,
  connectionId as toConnectionId,
  type AccountRecord,
  type Credentials,
  type CredentialsRef,
  type RecordKind,
  type UserId,
} from '@sc/api';

import type { JournalAnnouncement, JournalEntry, JournalEntity, LocalDatabase, SecureCredentialStore } from '../ports';
import { accountWide } from '../scope';

/** The record kind each journaled entity travels as. */
const KIND_OF: Readonly<Record<JournalEntity, RecordKind>> = {
  user: 'profile',
  userPin: 'pin',
  preferences: 'preference',
  connection: 'connection',
  connectionProfileValues: 'profileValues',
  subscription: 'subscription',
  playlist: 'playlist',
  favoriteChannel: 'favoriteChannel',
  watchProgress: 'watchProgress',
  accountSetting: 'setting',
};

const ENTITY_OF: Readonly<Record<RecordKind, JournalEntity>> = {
  profile: 'user',
  pin: 'userPin',
  preference: 'preferences',
  connection: 'connection',
  profileValues: 'connectionProfileValues',
  subscription: 'subscription',
  playlist: 'playlist',
  favoriteChannel: 'favoriteChannel',
  watchProgress: 'watchProgress',
  setting: 'accountSetting',
};

/** Parents first: a batch writes a profile before its PIN, a connection before its profiles' values. */
export const PARENTS_FIRST: readonly RecordKind[] = [
  'profile',
  'pin',
  'preference',
  'connection',
  'profileValues',
  // A subscription and a favourite channel point at a profile and a
  // connection; a playlist at a profile.
  'subscription',
  'favoriteChannel',
  'playlist',
  // A watch record's profile is in its key; a setting has no parent at all.
  'watchProgress',
  'setting',
];

/** A record's identity across the journal and the account: its kind and key. Journal ids are record keys already. */
export const identityOf = (record: Pick<AccountRecord, 'kind' | 'key'>): string => `${record.kind}/${record.key}`;

export const identityOfEntry = (entry: Pick<JournalEntry, 'entity' | 'entityId'>): string => `${KIND_OF[entry.entity]}/${entry.entityId}`;

/**
 * The profile a record's key names: a profile's, a PIN's, a preference's, a
 * watch record's, a profile's values'. Nothing for the account's own — a
 * connection, a setting — and nothing for a subscription, a favourite or a
 * playlist, whose key is a generated id: whose those are comes from their
 * row, their body or their journal entry.
 */
export function ownerByKey(kind: RecordKind, key: string): UserId | undefined {
  const [first, second] = key.split('/');
  switch (kind) {
    case 'profile':
    case 'pin':
    case 'preference':
    case 'watchProgress':
      return first ? toUserId(first) : undefined;
    case 'profileValues':
      return second ? toUserId(second) : undefined;
    default:
      return undefined;
  }
}

/** A local row, announced as if just changed: how a sign-up uploads, and how a row a server lost goes back. */
export function announcementOf(kind: RecordKind, key: string, owner?: string): JournalAnnouncement {
  const userId = ownerByKey(kind, key) ?? (kind === 'setting' || kind === 'connection' ? undefined : owner);
  return { ...(userId ? { userId: toUserId(userId) } : {}), entity: ENTITY_OF[kind], entityId: key, operation: 'upsert', localVersion: 0 };
}

/**
 * The record a journal entry sends: its entity as it is now — an entry points
 * at data and never copies it — or its tombstone. Nothing when there is
 * nothing to send: a sync plugin's connection, a row gone since (its delete
 * comes later in the journal), or a PIN or password this device cannot read,
 * never sent as "none". Read outside any transaction: the keychain is no part
 * of one.
 */
export async function recordFor(
  entry: Pick<JournalEntry, 'entity' | 'entityId' | 'operation'>,
  deps: { readonly db: LocalDatabase; readonly credentials: SecureCredentialStore },
): Promise<AccountRecord | undefined> {
  const kind = KIND_OF[entry.entity];
  const key = entry.entityId;
  const tombstone: AccountRecord = { kind, key, deleted: true } as AccountRecord;
  const secretsOf = async (ref: CredentialsRef | undefined, listed: readonly string[]): Promise<Credentials | undefined> => {
    if (!ref || listed.length === 0) return {};
    const saved = await deps.credentials.read(ref).catch(() => undefined);
    if (!saved) return undefined;
    const picked: Record<string, string> = {};
    for (const name of listed) if (saved[name] !== undefined) picked[name] = saved[name];
    return picked;
  };

  let record: AccountRecord | undefined;
  switch (entry.entity) {
    case 'user': {
      if (entry.operation === 'delete') return tombstone;
      const user = await deps.db.users.get(toUserId(key));
      record = user && { kind: 'profile', key, deleted: false, data: { userId: user.id, name: user.name } };
      break;
    }
    case 'userPin': {
      const user = await deps.db.users.get(toUserId(key));
      if (!user) return undefined;
      if (!user.pinCredentialRef) record = { kind: 'pin', key, deleted: false, data: { userId: user.id, pin: null } };
      else {
        const pin = (await deps.credentials.read(user.pinCredentialRef).catch(() => undefined))?.pin;
        if (pin === undefined) return undefined;
        record = { kind: 'pin', key, deleted: false, data: { userId: user.id, pin } };
      }
      break;
    }
    case 'preferences': {
      const [owner = '', name = ''] = key.split('/');
      if (entry.operation === 'delete') return tombstone;
      const value = ((await deps.db.preferences.get(toUserId(owner))) as Readonly<Record<string, unknown>>)[name];
      record = value === undefined ? tombstone : { kind: 'preference', key, deleted: false, data: { userId: toUserId(owner), name, value } };
      break;
    }
    case 'connection': {
      if (entry.operation === 'delete') return tombstone;
      const connection = await deps.db.connections.get(toConnectionId(key));
      if (!connection || !accountWide(connection.pluginId)) return undefined;
      const secretKeys = connection.values.secretKeys ?? [];
      const secrets = await secretsOf(connection.values.credentialsRef, secretKeys);
      record = {
        kind: 'connection',
        key,
        deleted: false,
        data: {
          connectionId: connection.id,
          pluginId: connection.pluginId,
          label: connection.label,
          enabled: connection.enabled,
          perProfile: connection.perProfile,
          fields: connection.values.fields,
          settings: connection.values.settings,
          secretKeys,
          // A password this device lacks is still listed: the server keeps the one another device saved.
          secrets: secrets ?? {},
        },
      };
      break;
    }
    case 'subscription': {
      if (entry.operation === 'delete') return tombstone;
      const subscription = await deps.db.subscriptions.get(key);
      record = subscription && {
        kind: 'subscription',
        key,
        deleted: false,
        data: {
          subscriptionId: subscription.id,
          userId: subscription.userId,
          connectionId: subscription.connectionId,
          externalId: subscription.externalId,
          title: subscription.title,
          addedAt: subscription.addedAt,
        },
      };
      break;
    }
    case 'favoriteChannel': {
      if (entry.operation === 'delete') return tombstone;
      const favorite = await deps.db.favoriteChannels.get(key);
      record = favorite && {
        kind: 'favoriteChannel',
        key,
        deleted: false,
        data: {
          favoriteId: favorite.id,
          userId: favorite.userId,
          connectionId: favorite.connectionId,
          externalId: favorite.externalId,
          name: favorite.name,
          ...(favorite.number === undefined ? {} : { number: favorite.number }),
          ...(favorite.logo === undefined ? {} : { logo: favorite.logo }),
          addedAt: favorite.addedAt,
        },
      };
      break;
    }
    case 'playlist': {
      if (entry.operation === 'delete') return tombstone;
      const playlist = await deps.db.playlists.get(key);
      record = playlist && {
        kind: 'playlist',
        key,
        deleted: false,
        data: {
          playlistId: playlist.id,
          userId: playlist.userId,
          title: playlist.title,
          ...(playlist.description === undefined ? {} : { description: playlist.description }),
          items: playlist.items,
          ...(playlist.source === undefined ? {} : { source: playlist.source }),
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
        },
      };
      break;
    }
    case 'watchProgress': {
      if (entry.operation === 'delete') return tombstone;
      const progress = await deps.db.watchProgress.get(key);
      record = progress && {
        kind: 'watchProgress',
        key,
        deleted: false,
        data: {
          userId: progress.userId,
          identity: progress.identity,
          ...(progress.externalIds === undefined ? {} : { externalIds: progress.externalIds }),
          round: progress.round,
          watched: progress.watched,
          ...(progress.positionMs === undefined ? {} : { positionMs: progress.positionMs }),
          ...(progress.durationMs === undefined ? {} : { durationMs: progress.durationMs }),
          ...(progress.item === undefined ? {} : { item: progress.item as unknown as Readonly<Record<string, unknown>> }),
          createdAt: progress.createdAt,
          updatedAt: progress.updatedAt,
        },
      };
      break;
    }
    case 'accountSetting': {
      if (entry.operation === 'delete') return tombstone;
      const setting = await deps.db.accountSettings.get(key);
      record = setting ? { kind: 'setting', key, deleted: false, data: { name: setting.name, value: setting.value } } : tombstone;
      break;
    }
    case 'connectionProfileValues': {
      const [ofConnection = '', ofUser = ''] = key.split('/');
      if (entry.operation === 'delete') return tombstone;
      const connection = await deps.db.connections.get(toConnectionId(ofConnection));
      if (!connection || !accountWide(connection.pluginId)) return undefined;
      const values = (await deps.db.connections.profileValues(connection.id)).get(toUserId(ofUser));
      if (!values) return undefined;
      const secretKeys = values.secretKeys ?? [];
      const secrets = await secretsOf(values.credentialsRef, secretKeys);
      record = {
        kind: 'profileValues',
        key,
        deleted: false,
        data: {
          connectionId: connection.id,
          userId: toUserId(ofUser),
          off: values.off === true,
          fields: values.fields,
          settings: values.settings,
          secretKeys,
          secrets: secrets ?? {},
        },
      };
      break;
    }
  }
  return record && isAccountRecord(record) ? record : undefined;
}

/**
 * The whole account as records, each row as it is now, parents first — what a
 * backup holds. Read outside any transaction: the keychain is no part of one.
 * A PIN or password this device cannot read is left out, never written as
 * "none".
 */
export async function recordsOfAccount(deps: { readonly db: LocalDatabase; readonly credentials: SecureCredentialStore }): Promise<readonly AccountRecord[]> {
  const { db } = deps;
  const wanted: Pick<JournalEntry, 'entity' | 'entityId' | 'operation'>[] = [];
  const upsert = (entity: JournalEntity, entityId: string) => wanted.push({ entity, entityId, operation: 'upsert' });
  const users = await db.users.list();
  for (const user of users) upsert('user', user.id);
  for (const user of users) if (user.pinCredentialRef) upsert('userPin', user.id);
  for (const user of users) {
    for (const name of Object.keys(await db.preferences.get(user.id))) upsert('preferences', `${user.id}/${name}`);
  }
  const connections = (await db.connections.list()).filter((connection) => accountWide(connection.pluginId));
  for (const connection of connections) upsert('connection', connection.id);
  for (const connection of connections) {
    for (const userId of (await db.connections.profileValues(connection.id)).keys()) upsert('connectionProfileValues', `${connection.id}/${userId}`);
  }
  // What a profile keeps for itself is the account's too, so a backup holds it.
  for (const subscription of await db.subscriptions.listAll()) upsert('subscription', subscription.id);
  for (const favorite of await db.favoriteChannels.listAll()) upsert('favoriteChannel', favorite.id);
  for (const playlist of await db.playlists.listAll()) upsert('playlist', playlist.id);
  for (const progress of await db.watchProgress.listAll()) upsert('watchProgress', progress.id);
  for (const setting of await db.accountSettings.list()) upsert('accountSetting', setting.name);
  const records: AccountRecord[] = [];
  for (const entry of wanted) {
    const record = await recordFor(entry, deps);
    if (record) records.push(record);
  }
  return records;
}
