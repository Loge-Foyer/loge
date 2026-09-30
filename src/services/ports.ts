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
  PlaybackReport,
  PluginId,
  UserId,
  WatchStatus,
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
 * A source's or an IPTV plugin's connections belong to the account, and are
 * journaled; a sync plugin's belong to the device, and never are. What a
 * profile keeps for itself on one lives in rows owned by that profile, which
 * go with the profile and with the connection.
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

export interface DeviceSettings {
  readonly defaultUserId?: UserId;
  /** A fingerprint of the device key, never the key: it spots a phone restored from another's backup. */
  readonly deviceKeyPrint?: string;
  /** This device's players: the ones switched off, and the one that plays first. Never journaled, never backed up. */
  readonly players?: { readonly off?: readonly PluginId[]; readonly preferred?: PluginId };
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
 * What this device knows of a profile's watch state for one item of a source
 * that masters it (v5). A local change lands here and in the outbox together;
 * the source wins again once nothing for the item waits in the outbox.
 */
export interface WatchEntry {
  readonly key: GlobalMediaKey;
  readonly status: WatchStatus;
  /** The item as last seen — for Continue Watching while the source is away. Kept only where its metadata may be. */
  readonly item?: MediaItem;
  readonly updatedAt: number;
}

export interface WatchStatusRepository {
  get(userId: UserId, key: GlobalMediaKey): Promise<WatchEntry | undefined>;
  /** A profile's entries, the most recently updated first. */
  list(userId: UserId): Promise<readonly WatchEntry[]>;
  /** Skipped when the profile or the connection is gone. */
  put(userId: UserId, entry: WatchEntry): Promise<void>;
  /** Entries not updated since `before`, for which nothing waits in the outbox. */
  prune(before: number): Promise<void>;
}

/** One report waiting for the source that masters the item's watch state. */
export interface OutboxEntry {
  readonly seq: number;
  readonly userId: UserId;
  readonly report: PlaybackReport;
  readonly createdAt: number;
  readonly attempts: number;
  /** Backing off: not tried again before this. */
  readonly notBefore?: number;
}

/**
 * What this device has to tell sources, oldest first. Device state: never
 * journaled, never on your server, never in a backup. Its rows go with their
 * profile and their connection.
 */
export interface OutboxRepository {
  /**
   * Queues a report. An item's newest progress replaces the progress waiting
   * before it, a stop takes that progress along, and the newest watched state
   * replaces the one before it — so a long evening offline stays a short queue.
   * Skipped when the profile or the connection is gone.
   */
  add(userId: UserId, report: PlaybackReport): Promise<void>;
  list(): Promise<readonly OutboxEntry[]>;
  /** The items of a profile with something waiting, as `connectionId/externalId`. */
  pendingKeys(userId: UserId): Promise<ReadonlySet<string>>;
  remove(seq: number): Promise<void>;
  defer(seq: number, attempts: number, notBefore: number): Promise<void>;
  /** Everything: a phone restored from another's backup must not report that phone's evenings. */
  clear(): Promise<void>;
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
  /** Whose entity this is. An attribute, not ownership: the journal outlives the profile. */
  readonly userId?: UserId;
  readonly entity: JournalEntity;
  readonly entityId: string;
  readonly operation: 'upsert' | 'delete';
  readonly changedAt: number;
  readonly localVersion: number;
}

/** A change recorded by hand: what a sign-up, or a server that lost a row, announces of this device's rows. */
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
  /** Forgets every entry up to `seq`: they reached the account, or there is none to reach. Seqs are never reused. */
  prune(through: number): Promise<void>;
}

export interface ChangeJournal extends JournalRepository {
  /** Called once a commit that journaled something is done; never after a rollback. */
  subscribe(listener: () => void): () => void;
}

/**
 * The device's account: kept here, or on your own server through the one
 * sync-category connection that reaches it. Device-owned and never journaled.
 */
export type StoredAccount =
  | { readonly kind: 'local'; readonly id: string; readonly name: string }
  | {
      readonly kind: 'server';
      readonly id: string;
      /** "faruk on home.example.com". */
      readonly name: string;
      readonly connectionId: ConnectionId;
      /** What the server said an account may hold. */
      readonly maxProfiles: number;
    };

/** Where this device stands with a server account. */
export interface AccountSync {
  /** Every journal entry up to here reached the account, or had nothing to send. */
  readonly checkpoint: number;
  readonly lastSyncedAt?: number;
  /** Profiles the server refused for its limit: kept on this device only, and tried again when there is room. */
  readonly heldBack: readonly UserId[];
}

export interface AccountRepository {
  get(): Promise<StoredAccount | undefined>;
  put(account: StoredAccount): Promise<void>;
  /** `{ checkpoint: 0, heldBack: [] }` before anything was synced. */
  sync(): Promise<AccountSync>;
  putSync(state: AccountSync): Promise<void>;
  /** No account: while one is replaced by another, or signed out of. */
  clear(): Promise<void>;
}

/**
 * What this device last saved to one backup target: which account, which
 * save, and the file's etag then — so a save never overwrites a file another
 * device changed since. Device state: never journaled, never backed up.
 */
export interface BackupState {
  readonly connectionId: ConnectionId;
  /** The account the file holds (its id): another one is another file. */
  readonly lineage: string;
  readonly generation: number;
  readonly etag?: string;
  readonly savedAt?: number;
}

export interface BackupStateRepository {
  get(connectionId: ConnectionId): Promise<BackupState | undefined>;
  /** Refused for a connection that does not exist; it goes with its connection. */
  put(state: BackupState): Promise<void>;
}

/** Everything the database keeps. Each write appends its journal entry in the same transaction. */
export interface Repositories {
  readonly users: UserRepository;
  readonly connections: ConnectionRepository;
  readonly deviceSettings: DeviceSettingsRepository;
  readonly preferences: PreferencesRepository;
  readonly mediaCache: MediaCacheRepository;
  readonly staleSecrets: StaleSecretQueue;
  readonly account: AccountRepository;
  readonly backupState: BackupStateRepository;
  readonly watchStatus: WatchStatusRepository;
  readonly outbox: OutboxRepository;
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

/** How asking the device's owner went. */
export type OwnerAnswer = 'verified' | 'cancelled' | 'refused' | 'unavailable';

/** Face ID, a fingerprint or the device's passcode — whoever owns the device. */
export interface OwnerAuthentication {
  /** Whether the device can ask at all: a passcode or a biometric is set up. */
  available(): Promise<boolean>;
  authenticate(reason: string): Promise<OwnerAnswer>;
}

/** Which ways the screen may turn: upright, as the app is laid out, or any way — a film fills a phone on its side. */
export interface ScreenOrientationControl {
  upright(): Promise<void>;
  free(): Promise<void>;
}

/** Whether the app is in front of someone. */
export interface AppActivity {
  active(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}

/** Holds a named lock while work runs — so two tabs of one browser never sync at once. */
export interface RunLock {
  run<T>(name: string, work: () => Promise<T>): Promise<T>;
}

export type LogCategory = 'app.boot' | 'user.session' | 'provider' | 'sync' | 'backup' | 'storage' | 'player';

export type LogFields = Readonly<Record<string, unknown>>;

/** Redaction happens behind this port, never at call sites. */
export interface Logger {
  debug(category: LogCategory, message: string, fields?: LogFields): void;
  warn(category: LogCategory, message: string, fields?: LogFields): void;
  error(category: LogCategory, message: string, fields?: LogFields): void;
}

export type BackupSqlValue = string | number | null;

/**
 * A backup file's database, built and read in memory — expo-sqlite on a
 * phone, sql.js in a browser — and never a database the app runs on.
 */
export interface BackupSqlDatabase {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly BackupSqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly BackupSqlValue[]): Promise<readonly T[]>;
  /** The database file, as bytes. */
  serialize(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface BackupSql {
  create(): Promise<BackupSqlDatabase>;
  /** Throws for bytes that are not a SQLite database. */
  open(bytes: Uint8Array): Promise<BackupSqlDatabase>;
}

/** A file the user picked: its size first, so one too large is refused before it is read. */
export interface PickedFile {
  readonly name: string;
  readonly size: number;
  read(): Promise<Uint8Array>;
}

/** Files the user moves in and out: the share sheet or a download, the document picker or a file input. */
export interface FileExchange {
  save(name: string, bytes: Uint8Array): Promise<'saved' | 'cancelled'>;
  /** Nothing when the user backed out. */
  pick(): Promise<PickedFile | undefined>;
}
