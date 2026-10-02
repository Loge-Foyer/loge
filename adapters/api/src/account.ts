import { encodeHex, encodeUtf8 } from './bytes';
import { CATEGORY_SCOPE, categoryOfPluginId } from './category';
import { PER_PROFILE_MODES, type PerProfile } from './connection';
import type { PluginContext, PluginTarget } from './context';
import type { Credentials, Field, FieldValues } from './fields';
import { isFieldValues, isId, isJson, isKey, isKeyList, isRecord, isText } from './guards';
import { identityHash } from './identity';
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

export const RECORD_KINDS = [
  'profile',
  'pin',
  'preference',
  'connection',
  'profileValues',
  'subscription',
  'playlist',
  'favoriteChannel',
  'watchProgress',
  'setting',
] as const;

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
  /**
   * A channel a profile follows on one connection. One record each rather than
   * one list, so two devices subscribing to different channels do not
   * overwrite each other and a delete wins on its own.
   */
  readonly subscription: {
    readonly subscriptionId: string;
    readonly userId: UserId;
    readonly connectionId: ConnectionId;
    /** The channel's id on that source. */
    readonly externalId: string;
    /** As it was when followed, so a list reads while the source is away. */
    readonly title: string;
    /** ISO 8601. */
    readonly addedAt: string;
  };
  /**
   * A live channel a profile keeps at hand on one connection — its ★. One
   * record each, as a subscription is, so two devices adding different
   * channels do not overwrite each other, and a removal wins on its own.
   */
  readonly favoriteChannel: {
    readonly favoriteId: string;
    readonly userId: UserId;
    readonly connectionId: ConnectionId;
    /** The channel's id on that source. */
    readonly externalId: string;
    /** As it was when chosen, so the list reads while the source is away. */
    readonly name: string;
    /** Its number on the source, from 1. */
    readonly number?: number;
    /** Its logo's reference, which only its own source resolves. */
    readonly logo?: string;
    /** ISO 8601. */
    readonly addedAt: string;
  };
  /**
   * A profile's own list, or a mirror of one a source holds. Edited as a
   * whole, so the whole-entity rule (spec §10) is the right grain: two devices
   * reordering the same list end on whichever pushed last.
   */
  readonly playlist: {
    readonly playlistId: string;
    readonly userId: UserId;
    readonly title: string;
    readonly description?: string;
    /** In order. A list may mix sources: a Jellyfin film beside a web video. */
    readonly items: readonly { readonly connectionId: ConnectionId; readonly externalId: string }[];
    /** Set when this mirrors a list the source holds; absent when it is the profile's own. */
    readonly source?: { readonly connectionId: ConnectionId; readonly externalId: string };
    /** ISO 8601. */
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  /**
   * Where a profile got to in something, and whether it is done — kept by the
   * app for a source that keeps no watch status of its own (spec §9). Keyed by
   * what it is apart from any source (`watchIdentity`), so every device, and
   * every copy of it on the account's sources, shares one record. Conflicts
   * resolve on the client, field by field (spec §10): a later `round` wins
   * whole, `watched` holds within one, and the position is the last push's.
   */
  readonly watchProgress: {
    readonly userId: UserId;
    /** `tmdb:movie:603`, `youtube:dQw4w9WgXcQ`, `title:movie:matrix:1999`. */
    readonly identity: string;
    /** Every catalogue id known for it, for a later match on another source. */
    readonly externalIds?: Readonly<Record<string, string>>;
    /** Bumped by "mark as unwatched", so that undoing it on one device is not undone by another. */
    readonly round: number;
    readonly watched: boolean;
    readonly positionMs?: number;
    readonly durationMs?: number;
    /** The item as it was last played — which source, which item, its title and picture — for the screens that list it. Untrusted: read it with care. */
    readonly item?: Readonly<Record<string, unknown>>;
    /** ISO 8601. For ordering what is shown — never for deciding a conflict. */
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  /** One of the account's own settings, the same for every profile and device: `watchStatus`. */
  readonly setting: { readonly name: string; readonly value: unknown };
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
/** A list long enough for anyone, short enough that the whole account still reads in one go. */
const MAX_LIST = 2_000;
/** An image reference is an address more often than not, and some run long. */
const MAX_LOGO = 2_048;
/** An identity is a catalogue id, or a title and a year: never long. */
const MAX_IDENTITY = 300;
const HASH = /^[0-9a-f]{16}$/;

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
    case 'subscription':
      return String((data as { subscriptionId?: string }).subscriptionId);
    case 'playlist':
      return String((data as { playlistId?: string }).playlistId);
    case 'favoriteChannel':
      return String((data as { favoriteId?: string }).favoriteId);
    case 'watchProgress':
      // Derived, never generated: two devices that start the same film offline write the same record.
      return `${String(parts.userId)}/${identityHash(String((data as { identity?: string }).identity))}`;
    case 'setting':
      return String(parts.name);
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
  if (kind === 'watchProgress') return parts.length === 2 && isId(parts[0]) && HASH.test(parts[1] ?? '');
  if (kind === 'setting') return parts.length === 1 && isKey(parts[0]);
  return parts.length === 1 && isId(parts[0]);
}

/** A list may mix sources, so each entry names its own connection. */
function isMediaKeyList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_LIST &&
    value.every((entry) => isRecord(entry) && isId(entry.connectionId) && isId(entry.externalId))
  );
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
    case 'subscription':
      return (
        isId(data.subscriptionId) &&
        isId(data.userId) &&
        isId(data.connectionId) &&
        isId(data.externalId) &&
        isText(data.title) &&
        isText(data.addedAt)
      );
    case 'playlist':
      return (
        isId(data.playlistId) &&
        isId(data.userId) &&
        isText(data.title) &&
        (data.title as string).trim() !== '' &&
        (data.description === undefined || isText(data.description)) &&
        isMediaKeyList(data.items) &&
        (data.source === undefined ||
          (isRecord(data.source) && isId(data.source.connectionId) && isId(data.source.externalId))) &&
        isText(data.createdAt) &&
        isText(data.updatedAt)
      );
    case 'favoriteChannel':
      return (
        isId(data.favoriteId) &&
        isId(data.userId) &&
        isId(data.connectionId) &&
        isId(data.externalId) &&
        isText(data.name) &&
        (data.name as string).trim() !== '' &&
        (data.number === undefined || (Number.isInteger(data.number) && (data.number as number) > 0)) &&
        (data.logo === undefined || (typeof data.logo === 'string' && data.logo !== '' && data.logo.length <= MAX_LOGO)) &&
        isText(data.addedAt)
      );
    case 'watchProgress':
      return (
        isId(data.userId) &&
        typeof data.identity === 'string' &&
        data.identity !== '' &&
        data.identity.length <= MAX_IDENTITY &&
        (data.externalIds === undefined || isIdMap(data.externalIds)) &&
        isCount(data.round) &&
        typeof data.watched === 'boolean' &&
        (data.positionMs === undefined || isCount(data.positionMs)) &&
        (data.durationMs === undefined || isCount(data.durationMs)) &&
        (data.item === undefined || (isRecord(data.item) && isJson(data.item))) &&
        isText(data.createdAt) &&
        isText(data.updatedAt)
      );
    case 'setting':
      return isKey(data.name) && isJson(data.value);
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

/** Sources, IPTV and metadata travel with the account; players and sync plugins stay on each device. */
function isAccountWide(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const category = categoryOfPluginId(value);
  return category !== undefined && CATEGORY_SCOPE[category] === 'account';
}

/** A whole number from nought: a position, a duration, a round. */
function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Catalogue ids, each a short text under a camelCase name. */
function isIdMap(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([key, id]) => isKey(key) && isId(id));
}

/** Passwords, only for the names the record lists. */
function isSecrets(value: unknown, secretKeys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, secret]) => secretKeys.includes(key) && typeof secret === 'string' && secret.length <= MAX_SECRET,
  );
}
