import {
  accountCarries,
  connectionId as toConnectionId,
  declaredRoles,
  isSyncChange,
  userId as toUserId,
  type Connection,
  type ConnectionId,
  type ConnectionRoles,
  type ConnectionValues,
  type CredentialsRef,
  type FieldValue,
  type FieldValues,
  type PluginCrypto,
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
import { profileSignInOf, sealPassword, signInOf, type VaultSource } from './sealed';

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
  /** This build's plugins: another plugin's connection is kept, never sent. */
  readonly manifestOf: (pluginId: PluginId) => PluginManifest | undefined;
  readonly account: ConnectionId;
  readonly carried: ReadonlySet<SyncCapability>;
  readonly crypto: PluginCrypto;
  /** Present when the account carries sealed passwords: connections travel with theirs. */
  readonly vault?: VaultSource;
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
  if (!change || isSyncChange(change)) return change;
  // Too long with its sealed passwords: the names still travel, and other devices keep their own or ask.
  const plain = withoutSealed(change);
  if (plain && isSyncChange(plain)) return plain;
  // Our own rows should always make sound changes; never send one that is not.
  out.log.warn('sync', 'A change could not be sent: it does not fit the sync contract', { entity: entry.entity });
  return undefined;
}

function withoutSealed(change: SyncChange): SyncChange | undefined {
  if (change.operation !== 'upsert') return undefined;
  if (change.entity === 'connection' && change.data.sealed) {
    const { sealed: _sealed, ...data } = change.data;
    return { ...change, data };
  }
  if (change.entity === 'profileValues' && change.data.sealed) {
    const { sealed: _sealed, ...data } = change.data;
    return { ...change, data };
  }
  return undefined;
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
      const manifest = connection && out.manifestOf(connection.pluginId);
      if (!connection || connection.roles.sync === true || !manifest) return undefined;
      const signIn = signInOf(connection.pluginId, manifest, connection.values.fields);
      const sealed = await sealedFor(out, `connection/${connectionId}`, connection.values, signIn);
      return { ...base, entity: 'connection', operation: 'upsert', data: { ...syncedConnection(connection), ...(sealed ? { sealed } : {}) } };
    }
    case 'connectionProfileValues': {
      const [ofConnection, ofUser] = pairOf(entry.entityId);
      const connectionId = toConnectionId(ofConnection);
      const userId = toUserId(ofUser);
      if (connectionId === out.account) return undefined;
      if (entry.operation === 'delete') return { ...base, entity: 'profileValues', operation: 'delete', target: { connectionId, userId } };
      const connection = await out.db.connections.get(connectionId);
      const manifest = connection && out.manifestOf(connection.pluginId);
      if (!connection || connection.roles.sync === true || !manifest) return undefined;
      const values = (await out.db.connections.profileValues(connectionId)).get(userId);
      if (!values) return undefined;
      const signIn = profileSignInOf(connection, manifest, values);
      const sealed = await sealedFor(out, `profileValues/${connectionId}/${userId}`, values, signIn);
      return { ...base, entity: 'profileValues', operation: 'upsert', data: { ...syncedProfileValues(connectionId, userId, values), ...(sealed ? { sealed } : {}) } };
    }
  }
}

/**
 * A scope's saved passwords, sealed for the account's other devices — read
 * outside any transaction, as a PIN is. Nothing when the account does not
 * carry them, or this device cannot read them: the names still travel, and
 * other devices keep their own or ask.
 */
async function sealedFor(out: Outgoing, key: string, values: ConnectionValues, signIn: string): Promise<Readonly<Record<string, string>> | undefined> {
  if (!out.vault || !values.credentialsRef || !values.secretKeys?.length) return undefined;
  const saved = await out.credentials.read(values.credentialsRef).catch(() => undefined);
  if (!saved) return undefined;
  // Asked only now, when there is something to seal. If the account cannot give it, the run stops: nothing goes half-sealed.
  const vault = await out.vault();
  const sealed: Record<string, string> = {};
  for (const field of values.secretKeys) {
    const password = saved[field];
    if (password === undefined) continue;
    const value = await sealPassword(out.crypto, vault, key, field, password, signIn);
    // One too long to travel is left out, never the whole change.
    if (value) sealed[field] = value;
  }
  return Object.keys(sealed).length > 0 ? sealed : undefined;
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
  /** The planned ref it took, which the transaction must not queue as unused. */
  readonly adopted?: CredentialsRef;
}

/**
 * A scope's passwords, opened from their seals and written under a fresh ref
 * before the transaction — the credential store is no part of one.
 */
export interface PlannedPasswords {
  readonly ref: CredentialsRef;
  /** The sign-in they were sealed for: taken only where the row, as the transaction finds it, signs in the same. */
  readonly signIn: string;
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** The profile as it arrives. Its PIN stays as it is here: a PIN travels on its own. */
export function mergeProfile(local: StoredUser | undefined, data: SyncedProfile): StoredUser {
  return { id: data.userId, name: data.name, ...(local?.pinCredentialRef ? { pinCredentialRef: local.pinCredentialRef } : {}) };
}

/**
 * A connection as it arrives, over what is here. Its sync role is never
 * taken: each device chooses its own account. It takes the passwords planned
 * for it when they were sealed for its sign-in; otherwise the password this
 * device holds is kept while the payload still lists one of its fields, and
 * signs in to the same place. The names listed are only ever the manifest's
 * password fields.
 */
export function mergeConnection(
  local: Connection | undefined,
  data: SyncedConnection,
  manifestOf: (pluginId: PluginId) => PluginManifest | undefined,
  planned?: PlannedPasswords,
): Merged<Connection> {
  const manifest = manifestOf(data.pluginId);
  const secretKeys = passwordsOf(manifest, data.secretKeys);
  const fields = declared(data.fields, manifest?.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key));
  const signIn = signInOf(data.pluginId, manifest, fields);
  const sameSignIn = local !== undefined && signInOf(local.pluginId, manifestOf(local.pluginId), local.values.fields) === signIn;
  const credentials = credentialsFor(local?.values, secretKeys, sameSignIn, signIn, planned);
  const row: Connection = {
    id: data.connectionId,
    pluginId: data.pluginId,
    label: data.label,
    roles: rolesOf(manifest, data.media),
    perProfile: data.perProfile,
    values: {
      fields,
      settings: declared(data.settings, manifest?.settings.map((setting) => setting.key)),
      ...(credentials.ref ? { credentialsRef: credentials.ref } : {}),
      ...(secretKeys.length > 0 ? { secretKeys } : {}),
    },
  };
  return { row, stale: credentials.stale, changed: !same(local, row), ...(credentials.adopted ? { adopted: credentials.adopted } : {}) };
}

/**
 * A profile's values on a connection as they arrive, their sign-in resolved
 * over the connection as it stands. Switched off, they hold nothing else — as
 * a save writes them.
 */
export function mergeProfileValues(
  local: ProfileValues | undefined,
  data: SyncedProfileValues,
  connection: Pick<Connection, 'pluginId' | 'perProfile' | 'values'>,
  manifest: PluginManifest | undefined,
  planned?: PlannedPasswords,
): Merged<ProfileValues> {
  if (data.off) {
    const row: ProfileValues = { fields: {}, settings: {}, off: true };
    return { row, stale: local?.credentialsRef ? [local.credentialsRef] : [], changed: !same(local, row) };
  }
  const secretKeys = passwordsOf(manifest, data.secretKeys);
  const fields = declared(data.fields, manifest?.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key));
  const settings = declared(data.settings, manifest?.settings.map((setting) => setting.key));
  const signIn = profileSignInOf(connection, manifest, { fields, settings });
  const sameSignIn = local !== undefined && profileSignInOf(connection, manifest, local) === signIn;
  const credentials = credentialsFor(local, secretKeys, sameSignIn, signIn, planned);
  const row: ProfileValues = {
    fields,
    settings,
    ...(credentials.ref ? { credentialsRef: credentials.ref } : {}),
    ...(secretKeys.length > 0 ? { secretKeys } : {}),
  };
  return { row, stale: credentials.stale, changed: !same(local, row), ...(credentials.adopted ? { adopted: credentials.adopted } : {}) };
}

/** The ref a row arrives with: the passwords planned for it, the ones held here while they still sign in to the same place, or none. */
function credentialsFor(
  local: ConnectionValues | undefined,
  arriving: readonly string[],
  sameSignIn: boolean,
  signIn: string,
  planned: PlannedPasswords | undefined,
): { readonly ref?: CredentialsRef; readonly adopted?: CredentialsRef; readonly stale: readonly CredentialsRef[] } {
  const ref = local?.credentialsRef;
  if (planned && planned.signIn === signIn) return { ref: planned.ref, adopted: planned.ref, stale: ref && ref !== planned.ref ? [ref] : [] };
  if (!ref) return { stale: [] };
  // A password never follows a connection to another address, username or plugin: the device asks instead.
  return sameSignIn && arriving.some((key) => local?.secretKeys?.includes(key)) ? { ref, stale: [] } : { stale: [ref] };
}

export function passwordsOf(manifest: PluginManifest | undefined, listed: readonly string[]): readonly string[] {
  if (!manifest) return listed;
  const passwords = new Set(manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key));
  return listed.filter((key) => passwords.has(key));
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
