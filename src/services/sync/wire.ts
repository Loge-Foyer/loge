import {
  accountCarries,
  connectionId as toConnectionId,
  declaredRoles,
  isSyncChange,
  userId as toUserId,
  type Connection,
  type ConnectionId,
  type ConnectionRoles,
  type CredentialsRef,
  type FieldValue,
  type FieldValues,
  type PluginId,
  type PluginManifest,
  type SyncCapability,
  type SyncChange,
  type SyncedConnection,
  type SyncedProfile,
  type SyncedProfileValues,
  type SyncEntity,
} from '@sc/api';

import { stableJson } from '../hash';
import type { JournalEntity, JournalEntry, LocalDatabase, Logger, ProfileValues, SecureCredentialStore, StoredUser } from '../ports';

/** What each journaled entity is called on the wire. */
export const WIRE_ENTITY: Readonly<Record<JournalEntity, SyncEntity>> = {
  user: 'profile',
  userPin: 'pin',
  preferences: 'preferences',
  connection: 'connection',
  connectionProfileValues: 'profileValues',
};

/** The same identity `syncKey()` gives a change, for a journal entry. */
export function keyOfEntry(entry: Pick<JournalEntry, 'entity' | 'entityId'>): string {
  return `${WIRE_ENTITY[entry.entity]}/${entry.entityId}`;
}

/** Journal ids for pairs are `a/b`; neither half ever contains a slash. */
function pairOf(entityId: string): readonly [string, string] {
  const at = entityId.indexOf('/');
  return [entityId.slice(0, at), entityId.slice(at + 1)];
}

/** Whether a change is about the account's own connection, whose details belong to this device alone. */
export function targetsAccount(change: SyncChange, account: ConnectionId): boolean {
  if (change.entity !== 'connection' && change.entity !== 'profileValues') return false;
  const of = change.operation === 'upsert' ? change.data : change.target;
  return of.connectionId === account;
}

export interface Outgoing {
  readonly db: LocalDatabase;
  readonly credentials: SecureCredentialStore;
  /** Plugins this build registers: another plugin's connection is kept, never sent. */
  readonly registered: (pluginId: PluginId) => boolean;
  readonly account: ConnectionId;
  readonly carried: ReadonlySet<SyncCapability>;
  readonly log: Logger;
}

/**
 * The change a journal entry sends, read from the row as it is now — an entry
 * points at data and never copies it. `undefined` when there is nothing to
 * send: the row is gone, the account does not carry it, it is the account's
 * own connection, or the PIN cannot be read here (never sent as "no PIN").
 */
export async function changeFor(entry: JournalEntry, out: Outgoing): Promise<SyncChange | undefined> {
  if (!entry.changeId) {
    out.log.warn('sync', 'A journal entry from before the account phase was left out');
    return undefined;
  }
  if (!accountCarries(out.carried, WIRE_ENTITY[entry.entity])) return undefined;
  const change = await build(entry, entry.changeId, out);
  if (change && !isSyncChange(change)) {
    // Our own rows should always make sound changes; never send one that is not.
    out.log.warn('sync', 'A change could not be sent: it does not fit the sync contract', { entity: entry.entity });
    return undefined;
  }
  return change;
}

async function build(entry: JournalEntry, id: string, out: Outgoing): Promise<SyncChange | undefined> {
  const base = { id, changedAt: entry.changedAt };
  switch (entry.entity) {
    case 'user': {
      const userId = toUserId(entry.entityId);
      if (entry.operation === 'delete') return { ...base, entity: 'profile', operation: 'delete', target: { userId } };
      const user = await out.db.users.get(userId);
      return user && { ...base, entity: 'profile', operation: 'upsert', data: { userId, name: user.name } };
    }
    case 'userPin': {
      const userId = toUserId(entry.entityId);
      const user = await out.db.users.get(userId);
      if (!user) return undefined;
      if (!user.pinCredentialRef) return { ...base, entity: 'pin', operation: 'upsert', data: { userId, pin: null } };
      const pin = (await out.credentials.read(user.pinCredentialRef).catch(() => undefined))?.pin;
      return pin === undefined ? undefined : { ...base, entity: 'pin', operation: 'upsert', data: { userId, pin } };
    }
    case 'preferences': {
      const [owner, key] = pairOf(entry.entityId);
      const userId = toUserId(owner);
      if (entry.operation === 'delete') return { ...base, entity: 'preferences', operation: 'delete', target: { userId, key } };
      const value = (await out.db.preferences.get(userId) as Readonly<Record<string, unknown>>)[key];
      return value === undefined ? undefined : { ...base, entity: 'preferences', operation: 'upsert', data: { userId, key, value } };
    }
    case 'connection': {
      const connectionId = toConnectionId(entry.entityId);
      if (connectionId === out.account) return undefined;
      if (entry.operation === 'delete') return { ...base, entity: 'connection', operation: 'delete', target: { connectionId } };
      const connection = await out.db.connections.get(connectionId);
      if (!connection || connection.roles.sync === true || !out.registered(connection.pluginId)) return undefined;
      return { ...base, entity: 'connection', operation: 'upsert', data: syncedConnection(connection) };
    }
    case 'connectionProfileValues': {
      const [ofConnection, ofUser] = pairOf(entry.entityId);
      const connectionId = toConnectionId(ofConnection);
      const userId = toUserId(ofUser);
      if (connectionId === out.account) return undefined;
      if (entry.operation === 'delete') return { ...base, entity: 'profileValues', operation: 'delete', target: { connectionId, userId } };
      const connection = await out.db.connections.get(connectionId);
      if (!connection || connection.roles.sync === true || !out.registered(connection.pluginId)) return undefined;
      const values = (await out.db.connections.profileValues(connectionId)).get(userId);
      return values && { ...base, entity: 'profileValues', operation: 'upsert', data: syncedProfileValues(connectionId, userId, values) };
    }
  }
}

function syncedConnection(connection: Connection): SyncedConnection {
  return {
    connectionId: connection.id,
    pluginId: connection.pluginId,
    label: connection.label,
    media: connection.roles.media === true,
    perProfile: connection.perProfile,
    fields: connection.values.fields,
    settings: connection.values.settings,
    secretKeys: connection.values.secretKeys ?? [],
  };
}

function syncedProfileValues(connectionId: ConnectionId, userId: StoredUser['id'], values: ProfileValues): SyncedProfileValues {
  return {
    connectionId,
    userId,
    off: values.off === true,
    fields: values.fields,
    settings: values.settings,
    secretKeys: values.secretKeys ?? [],
  };
}

/** A row as it arrives, the refs it stops pointing at, and whether it differs from what is here. */
export interface Merged<T> {
  readonly row: T;
  readonly stale: readonly CredentialsRef[];
  readonly changed: boolean;
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** The profile as it arrives. Its PIN stays as it is here: a PIN travels on its own. */
export function mergeProfile(local: StoredUser | undefined, data: SyncedProfile): StoredUser {
  return { id: data.userId, name: data.name, ...(local?.pinCredentialRef ? { pinCredentialRef: local.pinCredentialRef } : {}) };
}

/**
 * A connection as it arrives, over what is here. Its sync role is never
 * taken: each device chooses its own account. The password this device holds
 * is kept while the payload still lists one of its fields; the names listed
 * are only ever the manifest's password fields.
 */
export function mergeConnection(local: Connection | undefined, data: SyncedConnection, manifest: PluginManifest | undefined): Merged<Connection> {
  const secretKeys = passwordsOf(manifest, data.secretKeys);
  const kept = keptRef(local?.values.credentialsRef, local?.values.secretKeys, secretKeys);
  const row: Connection = {
    id: data.connectionId,
    pluginId: data.pluginId,
    label: data.label,
    roles: rolesOf(manifest, data.media),
    perProfile: data.perProfile,
    values: {
      fields: declared(data.fields, manifest?.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key)),
      settings: declared(data.settings, manifest?.settings.map((setting) => setting.key)),
      ...(kept.ref ? { credentialsRef: kept.ref } : {}),
      ...(secretKeys.length > 0 ? { secretKeys } : {}),
    },
  };
  return { row, stale: kept.stale, changed: !same(local, row) };
}

/** A profile's values on a connection as they arrive. Switched off, they hold nothing else — as a save writes them. */
export function mergeProfileValues(
  local: ProfileValues | undefined,
  data: SyncedProfileValues,
  manifest: PluginManifest | undefined,
): Merged<ProfileValues> {
  if (data.off) {
    const row: ProfileValues = { fields: {}, settings: {}, off: true };
    return { row, stale: local?.credentialsRef ? [local.credentialsRef] : [], changed: !same(local, row) };
  }
  const secretKeys = passwordsOf(manifest, data.secretKeys);
  const kept = keptRef(local?.credentialsRef, local?.secretKeys, secretKeys);
  const row: ProfileValues = {
    fields: declared(data.fields, manifest?.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key)),
    settings: declared(data.settings, manifest?.settings.map((setting) => setting.key)),
    ...(kept.ref ? { credentialsRef: kept.ref } : {}),
    ...(secretKeys.length > 0 ? { secretKeys } : {}),
  };
  return { row, stale: kept.stale, changed: !same(local, row) };
}

function passwordsOf(manifest: PluginManifest | undefined, listed: readonly string[]): readonly string[] {
  if (!manifest) return listed;
  const passwords = new Set(manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key));
  return listed.filter((key) => passwords.has(key));
}

function keptRef(
  ref: CredentialsRef | undefined,
  localKeys: readonly string[] | undefined,
  arriving: readonly string[],
): { readonly ref?: CredentialsRef; readonly stale: readonly CredentialsRef[] } {
  if (!ref) return { stale: [] };
  return arriving.some((key) => localKeys?.includes(key)) ? { ref, stale: [] } : { stale: [ref] };
}

function declared(values: FieldValues, keys: readonly string[] | undefined): FieldValues {
  if (!keys) return values;
  const picked: Record<string, FieldValue> = {};
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

/** The roles a save would write: one per declared role, media from the payload, sync never. */
function rolesOf(manifest: PluginManifest | undefined, media: boolean): ConnectionRoles {
  if (!manifest) return { media };
  const roles: Partial<Record<'media' | 'sync', boolean>> = {};
  for (const role of declaredRoles(manifest)) roles[role] = role === 'media' ? media : false;
  return roles;
}
