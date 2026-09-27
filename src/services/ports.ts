import type {
  CancelSignal,
  Connection,
  ConnectionId,
  ConnectionValues,
  Credentials,
  CredentialsRef,
  GlobalMediaKey,
  MediaDetail,
  MediaItem,
  NetworkKind,
  PluginId,
  SyncCapability,
  SyncCursor,
  UserId,
} from '@sc/api';

import type { HomeLayout } from './home-layout';

// What the services need from storage and the device. The database is SQLite
// on native and IndexedDB on web; the services cannot tell which.

export interface StoredUser {
  readonly id: UserId;
  readonly name: string;
  /** Present when the profile has a PIN; the PIN itself lives in the credential store. */
  readonly pinCredentialRef?: CredentialsRef;
}

export interface UserRepository {
  list(): Promise<readonly StoredUser[]>;
  get(id: UserId): Promise<StoredUser | undefined>;
  insert(user: StoredUser): Promise<void>;
  update(user: StoredUser): Promise<void>;
  /** Removes the user and — like the database cascade — its per-profile values and preferences. */
  delete(id: UserId): Promise<void>;
}

/** What one profile keeps for itself on a connection that separates values per profile. */
export interface ProfileValues extends ConnectionValues {
  /**
   * The profile chose not to use the connection. It holds no values, and the
   * profile neither sees the connection nor is asked to finish setting it up.
   */
  readonly off?: true;
}

/**
 * Connections belong to the device. What a profile keeps for itself on one
 * lives in rows owned by that profile, which go with the profile and with the
 * connection.
 */
export interface ConnectionRepository {
  list(): Promise<readonly Connection[]>;
  get(id: ConnectionId): Promise<Connection | undefined>;
  insert(connection: Connection): Promise<void>;
  update(connection: Connection): Promise<void>;
  /** Also removes every profile's own values for it. */
  delete(id: ConnectionId): Promise<void>;
  profileValues(id: ConnectionId): Promise<ReadonlyMap<UserId, ProfileValues>>;
  valuesOfProfile(userId: UserId): Promise<ReadonlyMap<ConnectionId, ProfileValues>>;
  putProfileValues(id: ConnectionId, userId: UserId, values: ProfileValues): Promise<void>;
  deleteProfileValues(id: ConnectionId, userId: UserId): Promise<void>;
}

/** Per plugin, on this device. A plugin missing here is not installed. */
export interface DevicePluginState {
  readonly enabled: boolean;
}

export interface DeviceSettings {
  readonly defaultUserId?: UserId;
  readonly plugins: Readonly<Partial<Record<PluginId, DevicePluginState>>>;
  /**
   * The journal's head when this device last left an account. What changed
   * after it is this device's own when it joins one again.
   */
  readonly leftAccountAt?: number;
}

export interface DeviceSettingsRepository {
  get(): Promise<DeviceSettings>;
  update(change: (current: DeviceSettings) => DeviceSettings): Promise<DeviceSettings>;
}

/** A profile's own preferences. User-owned: they go with the profile. */
export interface UserPreferences {
  readonly homeLayout?: HomeLayout;
}

export interface PreferencesRepository {
  get(userId: UserId): Promise<UserPreferences>;
  update(userId: UserId, change: (current: UserPreferences) => UserPreferences): Promise<UserPreferences>;
}

/** What a source answered for one list, as it was when saved. */
export interface SavedList {
  readonly items: readonly MediaItem[];
  readonly savedAt: number;
}

export interface SavedDetail {
  readonly detail: MediaDetail;
  readonly savedAt: number;
}

/**
 * What sources answered, kept per profile so a screen can show it while the
 * source is slow or unreachable. A cache, not user state: nothing here is
 * journaled. Every entry carries the fingerprint of the values the source
 * ran with, and one saved under other values is never served.
 */
export interface MediaCacheRepository {
  list(userId: UserId, connectionId: ConnectionId, key: string, fingerprint: string): Promise<SavedList | undefined>;
  /** Skipped when the profile or the connection is gone. */
  putList(userId: UserId, connectionId: ConnectionId, key: string, fingerprint: string, list: SavedList): Promise<void>;
  removeList(userId: UserId, connectionId: ConnectionId, key: string): Promise<void>;
  detail(userId: UserId, key: GlobalMediaKey, fingerprint: string): Promise<SavedDetail | undefined>;
  /** Skipped when the profile or the connection is gone. */
  putDetail(userId: UserId, fingerprint: string, saved: SavedDetail): Promise<void>;
  removeDetail(userId: UserId, key: GlobalMediaKey): Promise<void>;
  /** Everything saved for a connection, or only for one profile's use of it. */
  purge(connectionId: ConnectionId, userId?: UserId): Promise<void>;
  /** Details, and lists whose key starts with `listPrefix`, not saved since `before`. */
  prune(before: number, listPrefix: string): Promise<void>;
}

/**
 * Credentials refs whose secrets are to be deleted. The keychain cannot list
 * what it holds, so a ref is queued in the same transaction that stops
 * pointing at it, and deleted from the credential store after the commit.
 */
export interface StaleSecretQueue {
  add(refs: readonly CredentialsRef[]): Promise<void>;
  list(): Promise<readonly CredentialsRef[]>;
  remove(refs: readonly CredentialsRef[]): Promise<void>;
}

/** A profile's PIN is journaled apart from its name, so a rename never carries a PIN away. */
export type JournalEntity = 'user' | 'userPin' | 'preferences' | 'connection' | 'connectionProfileValues';

/**
 * One local change, for the sync engine to carry later: a pointer to the
 * entity, never its values. `seq` is assigned by the database, in the order
 * changes committed.
 */
export interface JournalEntry {
  readonly seq: number;
  /**
   * Random, and the same every time the change is sent: the account
   * deduplicates by it. Entries written before the account phase have none,
   * and are never sent — every account starts with a join above them.
   */
  readonly changeId?: string;
  /** Whose entity this is. An attribute, not ownership: the journal outlives the profile. */
  readonly userId?: UserId;
  readonly entity: JournalEntity;
  readonly entityId: string;
  readonly operation: 'upsert' | 'delete';
  readonly changedAt: number;
  readonly localVersion: number;
}

/** A change recorded by hand: what joining an account announces of this device's rows. */
export type JournalAnnouncement = Pick<JournalEntry, 'entity' | 'entityId' | 'operation' | 'localVersion'> & {
  readonly userId?: UserId;
};

export interface JournalRepository {
  /** Entries after `seq`, oldest first, at most `limit` of them. */
  entries(after?: number, limit?: number): Promise<readonly JournalEntry[]>;
  /** The last entry's `seq`; 0 for an empty journal. */
  head(): Promise<number>;
  count(after: number): Promise<number>;
  /** Records changes by hand — inside an unjournaled transaction too. */
  announce(changes: readonly JournalAnnouncement[]): Promise<void>;
}

export interface ChangeJournal extends JournalRepository {
  /** Called once a commit that journaled something is done; never after a rollback. */
  subscribe(listener: () => void): () => void;
}

/**
 * Where this device stands with its account. Device-owned and never
 * journaled; it goes with the account's connection.
 */
export interface SyncState {
  readonly connectionId: ConnectionId;
  /** Where this device is in the account's log. */
  readonly cursor?: SyncCursor;
  /** Every journal entry up to here has been accepted by the account, or had nothing to send. */
  readonly checkpoint: number;
  /** This device's accepted changes the account has not returned yet: entity key → change id. */
  readonly awaiting: Readonly<Record<string, string>>;
  /** What the account carried when this device last joined it. */
  readonly carried: readonly SyncCapability[];
  readonly lastSyncedAt?: number;
}

export interface SyncStateRepository {
  get(connectionId: ConnectionId): Promise<SyncState | undefined>;
  /** Refused for a connection that is gone. */
  put(state: SyncState): Promise<void>;
  remove(connectionId: ConnectionId): Promise<void>;
}

/** Everything the database keeps. Each write appends its journal entry in the same transaction. */
export interface Repositories {
  readonly users: UserRepository;
  readonly connections: ConnectionRepository;
  readonly deviceSettings: DeviceSettingsRepository;
  readonly preferences: PreferencesRepository;
  readonly mediaCache: MediaCacheRepository;
  readonly staleSecrets: StaleSecretQueue;
  readonly syncState: SyncStateRepository;
  readonly journal: JournalRepository;
}

/**
 * The local database — SQLite on native, IndexedDB on web. Called directly, a
 * repository method is a transaction of its own.
 */
export interface LocalDatabase extends Repositories {
  /**
   * Several writes that land together or not at all. `work` may await only
   * the repositories it is given: IndexedDB commits a transaction the moment
   * it waits on anything else, and SQLite would wait on itself for ever.
   * Secrets are written before and deleted after, never in between.
   */
  transaction<T>(work: (tx: Repositories) => Promise<T>): Promise<T>;
  readonly journal: ChangeJournal;
}

/**
 * The database as the sync engine and the account service see it. What
 * arrives from the account is not this device's change, so it is written
 * without journaling it — or it would be sent straight back.
 */
export interface SyncDatabase extends LocalDatabase {
  unjournaled<T>(work: (tx: Repositories) => Promise<T>): Promise<T>;
}

/** Keychain on native, encrypted IndexedDB on web. */
export interface SecureCredentialStore {
  read(ref: CredentialsRef): Promise<Credentials | undefined>;
  write(ref: CredentialsRef, credentials: Credentials): Promise<void>;
  delete(ref: CredentialsRef): Promise<void>;
}

export interface IdGenerator {
  next(): string;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: CancelSignal): Promise<void>;
}

export interface NetworkMonitor {
  current(): NetworkKind;
  /** Called with each new kind of network, and the one before it — never for repeats. */
  subscribe(listener: (kind: NetworkKind, previous: NetworkKind) => void): () => void;
}

/** Who this app is to a server. `deviceKey` is stable for this install. */
export interface ClientIdentity {
  readonly appName: string;
  readonly appVersion: string;
  readonly deviceName: string;
  readonly deviceKey: string;
}

/** Some of it takes the device a moment to answer, so it is asked for once, when first needed. */
export interface ClientIdentitySource {
  identity(): Promise<ClientIdentity>;
}

export type LogCategory = 'app.boot' | 'user.session' | 'provider' | 'sync' | 'storage' | 'player';

export type LogFields = Readonly<Record<string, unknown>>;

/** Redaction happens behind this port, never at call sites. */
export interface Logger {
  debug(category: LogCategory, message: string, fields?: LogFields): void;
  warn(category: LogCategory, message: string, fields?: LogFields): void;
  error(category: LogCategory, message: string, fields?: LogFields): void;
}
