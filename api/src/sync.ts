import type { Brand } from './brand';
import type { SyncCapability } from './capabilities';
import { PER_PROFILE_MODES, type PerProfile } from './connection';
import type { PluginContext, PluginTarget } from './context';
import { isLibrarySelection, type FieldValues } from './fields';
import type { CancelSignal } from './http';
import type { ConnectionId, PluginId, UserId } from './ids';

/**
 * What an account can be handed: one kind per entity the app journals. The
 * account stores and returns them in its own order; it never reads them and
 * never decides between two. Passwords are not among them — Phase 4 seals the
 * password fields of `connection` and `profileValues` end to end.
 */
export const SYNC_ENTITIES = ['profile', 'pin', 'preferences', 'connection', 'profileValues'] as const;

export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/** Every capability an account's effective set needs before it is handed an entity. */
export const SYNC_ENTITY_CAPABILITIES: Readonly<Record<SyncEntity, readonly SyncCapability[]>> = {
  profile: ['profile'],
  pin: ['profile'],
  preferences: ['profile', 'preferences'],
  connection: ['providerConnections'],
  profileValues: ['providerConnections', 'profile'],
};

export function accountCarries(capabilities: ReadonlySet<SyncCapability>, entity: SyncEntity): boolean {
  return SYNC_ENTITY_CAPABILITIES[entity].every((capability) => capabilities.has(capability));
}

export interface ProfileTarget {
  readonly userId: UserId;
}

export interface PreferenceTarget {
  readonly userId: UserId;
  readonly key: string;
}

export interface ConnectionTarget {
  readonly connectionId: ConnectionId;
}

export interface ProfileValuesTarget {
  readonly connectionId: ConnectionId;
  readonly userId: UserId;
}

export interface SyncedProfile extends ProfileTarget {
  readonly name: string;
}

/** A child lock rather than an account secret (spec §17): four digits, or none. */
export interface SyncedPin extends ProfileTarget {
  readonly pin: string | null;
}

export interface SyncedPreference extends PreferenceTarget {
  /** Any JSON. The app reads it; the account never does. */
  readonly value: unknown;
}

export interface SyncedConnection extends ConnectionTarget {
  readonly pluginId: PluginId;
  readonly label: string;
  /** Whether it serves media. Its sync role never travels: each device chooses its own account. */
  readonly media: boolean;
  readonly perProfile: PerProfile;
  readonly fields: FieldValues;
  readonly settings: FieldValues;
  /** The password fields holding a value — names only, never the values. */
  readonly secretKeys: readonly string[];
}

export interface SyncedProfileValues extends ProfileValuesTarget {
  readonly off: boolean;
  readonly fields: FieldValues;
  readonly settings: FieldValues;
  readonly secretKeys: readonly string[];
}

interface ChangeCommon {
  /** Unique for ever, and the same each time this change is sent again: the account deduplicates by it. */
  readonly id: string;
  /** When the device that made it made it. Informational — order comes from the account's log. */
  readonly changedAt: number;
}

/** One change, as it travels. A PIN is removed by `pin: null`, never deleted on its own. */
export type SyncChange = ChangeCommon &
  (
    | { readonly entity: 'profile'; readonly operation: 'upsert'; readonly data: SyncedProfile }
    | { readonly entity: 'profile'; readonly operation: 'delete'; readonly target: ProfileTarget }
    | { readonly entity: 'pin'; readonly operation: 'upsert'; readonly data: SyncedPin }
    | { readonly entity: 'preferences'; readonly operation: 'upsert'; readonly data: SyncedPreference }
    | { readonly entity: 'preferences'; readonly operation: 'delete'; readonly target: PreferenceTarget }
    | { readonly entity: 'connection'; readonly operation: 'upsert'; readonly data: SyncedConnection }
    | { readonly entity: 'connection'; readonly operation: 'delete'; readonly target: ConnectionTarget }
    | { readonly entity: 'profileValues'; readonly operation: 'upsert'; readonly data: SyncedProfileValues }
    | { readonly entity: 'profileValues'; readonly operation: 'delete'; readonly target: ProfileValuesTarget }
  );

/** The one identity of what a change is about, so the app and the account agree on it. */
export function syncKey(change: SyncChange): string {
  const of = change.operation === 'upsert' ? change.data : change.target;
  switch (change.entity) {
    case 'profile':
    case 'pin':
      return `${change.entity}/${(of as ProfileTarget).userId}`;
    case 'preferences': {
      const { userId, key } = of as PreferenceTarget;
      return `preferences/${userId}/${key}`;
    }
    case 'connection':
      return `connection/${(of as ConnectionTarget).connectionId}`;
    case 'profileValues': {
      const { connectionId, userId } = of as ProfileValuesTarget;
      return `profileValues/${connectionId}/${userId}`;
    }
  }
}

/** Where a device is in the account's log. Opaque: only the account that made it can read it. */
export type SyncCursor = Brand<string, 'SyncCursor'>;

export const syncCursor = (value: string): SyncCursor => value as SyncCursor;

export type PullResult =
  | {
      readonly kind: 'changes';
      /** In the account's order — the caller's own changes included. */
      readonly changes: readonly SyncChange[];
      readonly cursor: SyncCursor;
      readonly more: boolean;
    }
  /** The account lost data, or never had any of this device's: the device joins again. */
  | { readonly kind: 'reset' }
  /** The cursor was compacted away, the data was not: the device reads from the start again. */
  | { readonly kind: 'expired' };

export interface PushResult {
  /** A prefix of the ids sent, in order, each one durably stored. */
  readonly accepted: readonly string[];
}

export interface SyncStatus {
  readonly accountName?: string;
}

/**
 * A connected account. It stores and returns changes; conflicts are the
 * app's. Every call may throw only `AppError`, with a retry hint.
 */
export interface ConnectedUserStateSyncProvider {
  readonly connectionId: ConnectionId;
  /** The log after `cursor` (from the start when there is none), the caller's own changes included. */
  pull(cursor: SyncCursor | undefined, signal?: CancelSignal): Promise<PullResult>;
  /** Idempotent by change id: a change already stored is accepted again, and stored once. */
  push(changes: readonly SyncChange[], signal?: CancelSignal): Promise<PushResult>;
  /** Reaches the account and signs in — what "Sign in" tries, once. */
  getStatus(signal?: CancelSignal): Promise<SyncStatus>;
  /** "Forgot PIN": resolves once whoever owns the account is verified, and throws `UNAUTHORIZED` otherwise. */
  verifyOwner?(signal?: CancelSignal): Promise<void>;
  dispose(): Promise<void>;
}

/** Connecting does no network work; signing in waits for the first call. */
export interface SyncRole {
  connect(target: PluginTarget, context: PluginContext): Promise<ConnectedUserStateSyncProvider>;
}

/** The members every connected account has. */
export const SYNC_PROVIDER_MEMBERS = ['pull', 'push', 'getStatus', 'dispose'] as const satisfies readonly (keyof ConnectedUserStateSyncProvider)[];

const PIN = /^\d{4}$/;
const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
const KEY = /^[a-z][A-Za-z0-9]*$/;
const MAX_ID = 128;
const MAX_TEXT = 200;
const MAX_DEPTH = 32;

/**
 * Whether something is a change this contract allows. Pulled data is
 * untrusted — it comes from whatever answers at the account's address — so
 * the app checks every change with this, and the sync server checks pushes
 * with it too.
 */
export function isSyncChange(value: unknown): value is SyncChange {
  if (!isRecord(value)) return false;
  const { id, changedAt, entity, operation } = value;
  if (!isId(id) || typeof changedAt !== 'number' || !Number.isFinite(changedAt)) return false;
  if (operation === 'upsert') return isUpsertData(entity, value.data);
  if (operation === 'delete') return isDeleteTarget(entity, value.target);
  return false;
}

function isUpsertData(entity: unknown, data: unknown): boolean {
  if (!isRecord(data)) return false;
  switch (entity) {
    case 'profile':
      return isId(data.userId) && isText(data.name) && (data.name as string).trim() !== '';
    case 'pin':
      return isId(data.userId) && (data.pin === null || (typeof data.pin === 'string' && PIN.test(data.pin)));
    case 'preferences':
      return isId(data.userId) && isKey(data.key) && isJson(data.value, 0);
    case 'connection':
      return (
        isId(data.connectionId) &&
        typeof data.pluginId === 'string' &&
        PLUGIN_ID.test(data.pluginId) &&
        isText(data.label) &&
        typeof data.media === 'boolean' &&
        (PER_PROFILE_MODES as readonly unknown[]).includes(data.perProfile) &&
        isFieldValues(data.fields) &&
        isFieldValues(data.settings) &&
        isKeyList(data.secretKeys)
      );
    case 'profileValues':
      return (
        isId(data.connectionId) &&
        isId(data.userId) &&
        typeof data.off === 'boolean' &&
        isFieldValues(data.fields) &&
        isFieldValues(data.settings) &&
        isKeyList(data.secretKeys)
      );
    default:
      return false;
  }
}

function isDeleteTarget(entity: unknown, target: unknown): boolean {
  if (!isRecord(target)) return false;
  switch (entity) {
    case 'profile':
      return isId(target.userId);
    case 'preferences':
      return isId(target.userId) && isKey(target.key);
    case 'connection':
      return isId(target.connectionId);
    case 'profileValues':
      return isId(target.connectionId) && isId(target.userId);
    default:
      // A PIN is never deleted on its own: removing one is `pin: null`.
      return false;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ids join into keys with `/`, so one containing it could pass for another. */
function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_ID && !value.includes('/');
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT;
}

function isKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID && KEY.test(value);
}

function isKeyList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= MAX_ID && value.every(isKey);
}

function isFieldValues(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, entry]) => isKey(key) && (typeof entry === 'string' || typeof entry === 'boolean' || isLibrarySelection(entry)),
  );
}

function isJson(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJson(entry, depth + 1));
  if (isRecord(value)) return Object.values(value).every((entry) => isJson(entry, depth + 1));
  return false;
}
