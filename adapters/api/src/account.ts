import { encodeHex, encodeUtf8 } from './bytes';
import { CATEGORY_SCOPE, categoryOfPluginId } from './category';
import { PER_PROFILE_MODES, type PerProfile } from './connection';
import type { PluginContext, PluginTarget } from './context';
import type { Credentials, Field, FieldValues } from './fields';
import { isFieldValues, isId, isJson, isKey, isKeyList, isRecord, isText } from './guards';
import type { CancelSignal } from './http';
import type { ConnectionId, PluginId, UserId } from './ids';

/**
 * The account on your own server, record by record. The server keeps one
 * collection per kind, and a device reads all of it on every sync: an account
 * is small — at most `maxProfiles` profiles, their PINs and preferences, and a
 * few connections.
 *
 * Passwords travel in plain text, in `secrets`, because the server is the
 * household's own. On a device they go straight to the keychain; the
 * database never holds one.
 */

/** Profiles an account may hold unless the server says otherwise (`SC_MAX_PROFILES`). */
export const DEFAULT_MAX_PROFILES = 10;

export const RECORD_KINDS = ['profile', 'pin', 'preference', 'connection', 'profileValues'] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export interface RecordData {
  readonly profile: { readonly userId: UserId; readonly name: string };
  /** A child lock rather than an account secret (spec §17): four digits, or none. Apart from the profile, so a rename never erases it. */
  readonly pin: { readonly userId: UserId; readonly pin: string | null };
  readonly preference: { readonly userId: UserId; readonly name: string; readonly value: unknown };
  readonly connection: {
    readonly connectionId: ConnectionId;
    readonly pluginId: PluginId;
    readonly label: string;
    readonly enabled: boolean;
    readonly perProfile: PerProfile;
    readonly fields: FieldValues;
    readonly settings: FieldValues;
    /** The names of its saved passwords, so a device without one asks rather than signing in with nothing. */
    readonly secretKeys: readonly string[];
    /** The passwords this device has; a name listed without a value keeps the stored one. */
    readonly secrets: Credentials;
  };
  readonly profileValues: {
    readonly connectionId: ConnectionId;
    readonly userId: UserId;
    readonly off: boolean;
    readonly fields: FieldValues;
    readonly settings: FieldValues;
    readonly secretKeys: readonly string[];
    readonly secrets: Credentials;
  };
}

/**
 * One record, or its tombstone. Deletes are soft, so every device learns of
 * one by reading; a deleted profile or connection stays deleted.
 */
export type AccountRecord = {
  [K in RecordKind]:
    | { readonly kind: K; readonly key: string; readonly deleted: false; readonly data: RecordData[K] }
    | { readonly kind: K; readonly key: string; readonly deleted: true };
}[RecordKind];

/** Every record of the account, deleted ones included. */
export interface AccountSnapshot {
  readonly records: readonly AccountRecord[];
}

/** Why a push was refused: the batch is all or nothing, so it names the write that stopped it. */
export type PushRefusal = 'limit' | 'deleted' | 'invalid';

export type PushOutcome =
  | { readonly kind: 'stored' }
  | { readonly kind: 'refused'; readonly index: number; readonly reason: PushRefusal };

export interface AccountInfo {
  readonly serverVersion: string;
  readonly maxProfiles: number;
  readonly signUp: 'invite' | 'open' | 'closed';
}

export interface AccountStatus {
  readonly accountId: string;
  /** Names the account's connection on this device: "faruk on home.example.com". */
  readonly accountName: string;
}

export interface AccountManifest {
  /** The password fields the owner check asks for again — Forgot PIN, switching and signing out. */
  readonly ownerProof?: { readonly fields: readonly string[] };
  /** Creating an account from the app: the fields it takes beyond the connection's own. */
  readonly signUp?: { readonly fields: readonly Field[] };
}

export interface ConnectedAccount {
  readonly connectionId: ConnectionId;
  /** The server's version, its profile limit and how it takes sign-ups — without signing in. */
  info(signal?: CancelSignal): Promise<AccountInfo>;
  /** Signs in, once: what "Sign in" tries. A refused sign-in is never tried again by itself. */
  status(signal?: CancelSignal): Promise<AccountStatus>;
  /** Creates the account with the `signUp` fields, tried once; with `firstProfile`, the server adds a profile named after it. */
  createAccount?(fields: FieldValues, options: { readonly firstProfile: boolean }, signal?: CancelSignal): Promise<AccountStatus>;
  /** Resolves when the `ownerProof` fields, typed again, are right; throws `UNAUTHORIZED` otherwise. */
  verifyOwner?(proof: Credentials, signal?: CancelSignal): Promise<void>;
  pull(signal?: CancelSignal): Promise<AccountSnapshot>;
  /** One batch, stored all or nothing, parents first. */
  push(records: readonly AccountRecord[], signal?: CancelSignal): Promise<PushOutcome>;
  /** Ends this device's session, where the server can. Tried once. */
  signOut?(signal?: CancelSignal): Promise<void>;
  dispose(): Promise<void>;
}

/** Connecting does no network work; signing in waits for the first call. */
export interface AccountRole {
  connect(target: PluginTarget, context: PluginContext): Promise<ConnectedAccount>;
}

/** The members every connected account has. */
export const ACCOUNT_MEMBERS = ['info', 'status', 'pull', 'push', 'dispose'] as const satisfies readonly (keyof ConnectedAccount)[];

/** The most a record may weigh, in characters of JSON. */
export const MAX_RECORD_LENGTH = 256 * 1024;

const PIN = /^\d{4}$/;
const MAX_SECRET = 4 * 1024;

/** A record's key: the app's own id, or its natural key (`userId/name`, `connectionId/userId`). */
export function recordKey<K extends RecordKind>(kind: K, data: RecordData[K]): string {
  const parts = data as Partial<Record<'userId' | 'connectionId' | 'name', string>>;
  switch (kind) {
    case 'profile':
    case 'pin':
      return String(parts.userId);
    case 'preference':
      return `${String(parts.userId)}/${String(parts.name)}`;
    case 'connection':
      return String(parts.connectionId);
    default:
      return `${String(parts.connectionId)}/${String(parts.userId)}`;
  }
}

/**
 * A record's id on your own server: the first 15 hex digits of SHA-256 over
 * the account's id, the kind and the key, a line apart. Derived, never chosen:
 * a resent write lands on the same record, two accounts on one server never
 * collide, and the server derives the same for the profile it creates at
 * sign-up. PocketBase's ids are 15 characters of `[a-z0-9]`.
 */
export async function recordId(
  sha256: (data: Uint8Array) => Promise<Uint8Array>,
  accountId: string,
  kind: RecordKind,
  key: string,
): Promise<string> {
  return encodeHex(await sha256(encodeUtf8(`${accountId}\n${kind}\n${key}`))).slice(0, 15);
}

/**
 * Whether something is a record this contract allows. What a server sends is
 * untrusted — it comes from whatever answers at the account's address — so the
 * app checks every record it reads with this.
 */
export function isAccountRecord(value: unknown): value is AccountRecord {
  if (!isRecord(value)) return false;
  const { kind, key, deleted } = value;
  if (!(RECORD_KINDS as readonly unknown[]).includes(kind) || typeof key !== 'string' || typeof deleted !== 'boolean') return false;
  const shaped = deleted ? isKeyOf(kind as RecordKind, key) : isData(kind as RecordKind, value.data) && recordKey(kind as RecordKind, value.data as never) === key;
  // Checked last: only a value of this shape is sure to serialize.
  return shaped && JSON.stringify(value).length <= MAX_RECORD_LENGTH;
}

function isKeyOf(kind: RecordKind, key: string): boolean {
  const parts = key.split('/');
  if (kind === 'preference') return parts.length === 2 && isId(parts[0]) && isKey(parts[1]);
  if (kind === 'profileValues') return parts.length === 2 && isId(parts[0]) && isId(parts[1]);
  return parts.length === 1 && isId(parts[0]);
}

function isData(kind: RecordKind, data: unknown): boolean {
  if (!isRecord(data)) return false;
  switch (kind) {
    case 'profile':
      return isId(data.userId) && isText(data.name) && (data.name as string).trim() !== '';
    case 'pin':
      return isId(data.userId) && (data.pin === null || (typeof data.pin === 'string' && PIN.test(data.pin)));
    case 'preference':
      return isId(data.userId) && isKey(data.name) && isJson(data.value);
    case 'connection':
      return (
        isId(data.connectionId) &&
        isAccountWide(data.pluginId) &&
        isText(data.label) &&
        typeof data.enabled === 'boolean' &&
        (PER_PROFILE_MODES as readonly unknown[]).includes(data.perProfile) &&
        isFieldValues(data.fields) &&
        isFieldValues(data.settings) &&
        isKeyList(data.secretKeys) &&
        isSecrets(data.secrets, data.secretKeys as readonly string[])
      );
    case 'profileValues':
      return (
        isId(data.connectionId) &&
        isId(data.userId) &&
        typeof data.off === 'boolean' &&
        isFieldValues(data.fields) &&
        isFieldValues(data.settings) &&
        isKeyList(data.secretKeys) &&
        isSecrets(data.secrets, data.secretKeys as readonly string[])
      );
  }
}

/** Only sources and IPTV travel with the account; players and sync plugins stay on each device. */
function isAccountWide(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const category = categoryOfPluginId(value);
  return category !== undefined && CATEGORY_SCOPE[category] === 'account';
}

/** Passwords, only for the names the record lists. */
function isSecrets(value: unknown, secretKeys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, secret]) => secretKeys.includes(key) && typeof secret === 'string' && secret.length <= MAX_SECRET,
  );
}
