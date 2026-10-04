import type {
  AppErrorCode,
  BufferingMode,
  CancelSignal,
  Connection,
  ConnectionId,
  ConnectionValues,
  Credentials,
  CredentialsRef,
  ExternalIds,
  GlobalMediaKey,
  ImageRef,
  MediaDetail,
  MediaItem,
  NetworkKind,
  PlaybackReport,
  PluginId,
  UserId,
  WatchStatus,
} from '@loge/api';

import type { HomeLayout } from './home-layout';
import type { ContentTab } from './tab-content';

// What the services need from storage and the device. The database is SQLite
// on native and IndexedDB on web; the services cannot tell which.

export interface StoredUser {
  readonly id: UserId;
  readonly name: string;
  /**
   * Present when the account keeps a PIN for the profile; the PIN itself
   * lives in the credential store. A device may decide one for itself
   * instead (`DeviceSettings.pins`).
   */
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

/**
 * What this device decided for one profile's PIN, in place of the account's:
 * with `ref`, a PIN of its own — in the credential store, never a row — and
 * without, none, whatever the account says.
 */
export interface DevicePin {
  readonly ref?: CredentialsRef;
}

export interface DeviceSettings {
  readonly defaultUserId?: UserId;
  /** A fingerprint of the device key, never the key: it spots a phone restored from another's backup. */
  readonly deviceKeyPrint?: string;
  /**
   * This device's players: the ones switched off, the one that plays first,
   * and the one that plays first on a tab, before it. Never journaled, never
   * backed up.
   */
  readonly players?: {
    readonly off?: readonly PluginId[];
    readonly preferred?: PluginId;
    readonly tabs?: Readonly<Partial<Record<ContentTab, PluginId>>>;
    /**
     * The order this device lists and tries them in, favourite first. Ids it
     * does not name follow, in the catalogue's order — so a player added by an
     * update appears without rewriting anything.
     */
    readonly order?: readonly PluginId[];
  };
  /** How this device behaves, whoever is watching. Never journaled, never backed up. */
  readonly app?: Partial<AppSettings>;
  /**
   * What this device keeps, and how much of it. Device-wide like players: a
   * copy on this phone is this phone's, so none of it is journaled, pushed or
   * backed up.
   */
  readonly downloads?: Partial<DownloadSettings>;
  /**
   * The Live group each profile chose last on each provider, here — profile
   * id, then connection id, then the group; `''` is All. It goes with its
   * profile and its provider (`services/live-groups.ts`).
   */
  readonly liveGroups?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * The profiles whose PIN this device decides for itself, by profile id
   * (`services/device-pins.ts`); one not named asks for the account's. Never
   * journaled, never on your server, never in a backup, and gone with its
   * profile.
   */
  readonly pins?: Readonly<Record<string, DevicePin>>;
}

export interface DownloadSettings {
  /** The ceiling for everything kept, in bytes. */
  readonly maxBytes: number;
  /** Nothing is fetched on mobile data while this is on. */
  readonly onlyOnWifi: boolean;
  /** What to ask a source for where it can make something smaller. */
  readonly maxHeight: number;
  /** Bits per second, which is what turns an 80 GB film into a 3 GB one. */
  readonly maxBitrate: number;
  /** Keep HDR, where the source has it and will hand it over. */
  readonly hdr: boolean;
  /** Ask the source to make a smaller copy, rather than taking the file as it is. */
  readonly askForSmaller: boolean;
}

/**
 * How this device behaves, whoever is watching — resolved, with every default
 * applied, so nothing downstream has to know what the default was.
 */
/**
 * A button the player may show. Two rows can hold these: the one beneath the
 * picture and the one floating at the top right. The top left is always the
 * title, and is not arranged.
 */
export const PLAYER_BUTTONS = ['audio', 'subtitles', 'speed', 'chapters', 'nextEpisode'] as const;

export type PlayerButton = (typeof PLAYER_BUTTONS)[number];

/**
 * What the pair either side of play does, and what a double tap on a half of
 * the picture does. `seek` moves by `seekMs`; `chapter` jumps to the one
 * before or after.
 */
export const PLAYER_JUMPS = ['off', 'seek', 'chapter'] as const;

export type PlayerJump = (typeof PLAYER_JUMPS)[number];

/** What an edge of the picture drags. Either edge may hold either, or neither. */
export const PLAYER_SLIDERS = ['off', 'brightness', 'volume'] as const;

export type PlayerSlider = (typeof PLAYER_SLIDERS)[number];

/** How a title page's buttons show what they do: the symbol alone, or the symbol and its words. */
export const BUTTON_LABELS = ['symbols', 'symbolsAndText'] as const;

export type ButtonLabels = (typeof BUTTON_LABELS)[number];

/** Light or dark, or as the device itself is set. */
export const APPEARANCES = ['system', 'light', 'dark'] as const;

/** How far ahead the player reads: as little as it needs, ahead in memory, or ahead on this device's storage. */
export const BUFFERINGS: readonly BufferingMode[] = ['off', 'memory', 'disk'];

export type AppearanceSetting = (typeof APPEARANCES)[number];

export interface AppSettings {
  /** The tab the app opens on when it starts. */
  readonly openOn: ContentTab;
  /**
   * Ask who is watching every time the app starts, rather than opening the
   * device's default profile. The default is still kept, for the day this is
   * switched off.
   */
  readonly alwaysChooseProfile: boolean;
  /** Turn the phone on its side for the player and hold it there. */
  readonly forceLandscape: boolean;
  /** How far a `seek` moves, each way. */
  readonly seekMs: number;
  /** The row beneath the picture, in order. */
  readonly buttons: readonly PlayerButton[];
  /** The row floating at the top right, in order. */
  readonly topButtons: readonly PlayerButton[];
  /** The pair either side of play. */
  readonly centreJump: PlayerJump;
  /** A double tap on the left or right half of the picture. */
  readonly doubleTap: PlayerJump;
  readonly leftSlider: PlayerSlider;
  readonly rightSlider: PlayerSlider;
  /** The figure at the right of the scrubber: what is left, or how long it is. */
  readonly showRemaining: boolean;
  /** How fast a press and hold plays while it is held. 1 turns it off. */
  readonly holdRate: number;
  /**
   * Picture in picture, and sound carrying on when the app is not in front.
   * Both are asked of the engine, and an engine without them simply does
   * neither — `playsHere` on a player says which it has.
   */
  readonly pictureInPicture: boolean;
  readonly backgroundPlayback: boolean;
  /**
   * Whether an engine may decode in software when the hardware decoder will
   * not take a stream. Off refuses it instead — slower, hotter and silent is
   * how a phone flattens its battery on a film it looked like it could play.
   * Only an engine that can tell the difference honours it.
   */
  readonly softwareFallback: boolean;
  /** A title page's buttons: their symbols alone, or with their words. Every one keeps its words for a screen reader. */
  readonly buttonLabels: ButtonLabels;
  /** Light or dark — the native chrome with it — or as the device is set. */
  readonly appearance: AppearanceSetting;
  /**
   * How far ahead the player reads, and where it keeps it: as little as it
   * needs, in memory — each engine's own read-ahead — or on this device's
   * storage, up to `bufferDiskBytes`, where an engine can (`buffersOnDisk`)
   * and a stream is worth it. Anything else reads ahead in memory.
   */
  readonly buffering: BufferingMode;
  /** The most a disk cache may hold, for one stream at a time. */
  readonly bufferDiskBytes: number;
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

/** Anything else a source answered — its channels, a guide — as it was when saved. */
export interface SavedValue<T> {
  readonly value: T;
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
  /** A saved answer that is not a list of items, under its own key — `live:`, `guide:` — kept beside the lists. */
  value<T>(userId: UserId, connectionId: ConnectionId, key: string, fingerprint: string): Promise<SavedValue<T> | undefined>;
  /** Skipped when the profile or the connection is gone. */
  putValue(userId: UserId, connectionId: ConnectionId, key: string, fingerprint: string, saved: SavedValue<unknown>): Promise<void>;
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

/**
 * A copy of one item kept on this device (v6). Device state, like the watch
 * cache: never journaled, never on your server, never in a backup — a file on
 * this phone is this phone's.
 *
 * **No address is kept.** A download's URL can carry an `api_key`, an HMAC
 * signature or a session token, so it is asked for again when a download
 * starts and when it resumes, exactly as playback asks again.
 */
export type DownloadState = 'queued' | 'running' | 'paused' | 'done' | 'failed';

export interface DownloadEntry {
  readonly id: string;
  readonly userId: UserId;
  readonly key: GlobalMediaKey;
  readonly state: DownloadState;
  /** What was chosen from `listDownloadOptions`, so a resume asks for the same. */
  readonly optionId?: string;
  /** The item as it was, so a Downloads list reads while every source is away. */
  readonly item: MediaItem;
  /** Under the downloads directory — never an absolute path, which changes between installs on iOS. */
  readonly fileName: string;
  readonly container: string;
  readonly bytesTotal?: number;
  readonly bytesDone: number;
  readonly errorCode?: AppErrorCode;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DownloadRepository {
  get(id: string): Promise<DownloadEntry | undefined>;
  /** One item is kept once per profile; this is how that is enforced. */
  forItem(userId: UserId, key: GlobalMediaKey): Promise<DownloadEntry | undefined>;
  /** A profile's downloads, newest first. */
  list(userId: UserId): Promise<readonly DownloadEntry[]>;
  /** Every profile's, for the budget and for the queue to find its work. */
  listAll(): Promise<readonly DownloadEntry[]>;
  /** Skipped when the profile or the connection is gone. */
  put(entry: DownloadEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

/** How a download is going, as the device reports it. */
export interface TransferProgress {
  readonly bytesDone: number;
  /** Absent where the server sent no length — a transcode, usually. */
  readonly bytesTotal?: number;
}

export interface TransferRequest {
  readonly uri: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Under the downloads directory, extension included. */
  readonly fileName: string;
  readonly onProgress: (progress: TransferProgress) => void;
  readonly signal: AbortSignal;
}

/**
 * Fetching a file and keeping it, and knowing how much room there is. The one
 * port that touches the filesystem — `src/platform/downloads.ts` on a phone,
 * and a refusal on the web, where there is nothing to keep a file in.
 */
export interface FileStore {
  readonly available: boolean;
  /**
   * Fetches to a temporary name and moves it into place on success, so a
   * half-written file is never mistaken for a finished one.
   */
  fetch(request: TransferRequest): Promise<TransferProgress>;
  /** Bytes of everything kept, whatever the database thinks. The disk is the truth. */
  used(): Promise<number>;
  /** What the device itself has left, which is a second ceiling over the user's. */
  free(): Promise<number>;
  remove(fileName: string): Promise<void>;
  /** Files no row points at — what a crash between the two leaves behind. */
  sweep(keep: ReadonlySet<string>): Promise<void>;
  uriOf(fileName: string): string;
}

/**
 * A channel a profile follows on one source (v7). Account-wide, unlike the
 * downloads beside it: the profile's own, and so wherever it signs in.
 */
export interface Subscription {
  readonly id: string;
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  /** The channel's id on that source. */
  readonly externalId: string;
  /** As it was when followed, so a list reads while the source is away. */
  readonly title: string;
  /** ISO 8601. */
  readonly addedAt: string;
  readonly version: number;
}

/**
 * A live channel a profile keeps at hand on one connection (v8): what the ★
 * before a provider's groups lists. Account-wide, like a subscription: the
 * profile's own, and so wherever it signs in.
 */
export interface FavoriteChannel {
  readonly id: string;
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  /** The channel's id on that source. */
  readonly externalId: string;
  /** As it was when chosen, so the list reads while the source is away. */
  readonly name: string;
  readonly number?: number;
  readonly logo?: ImageRef;
  /** ISO 8601. */
  readonly addedAt: string;
  readonly version: number;
}

/**
 * A profile's own list, or a mirror of one a source holds. Edited as a whole,
 * which is why its items are one column rather than rows of their own.
 */
export interface Playlist {
  readonly id: string;
  readonly userId: UserId;
  readonly title: string;
  readonly description?: string;
  /** In order. A list may mix sources: a Jellyfin film beside a web video. */
  readonly items: readonly GlobalMediaKey[];
  /** Set when this mirrors a list the source holds. */
  readonly source?: GlobalMediaKey;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface SubscriptionRepository {
  list(userId: UserId): Promise<readonly Subscription[]>;
  /** For the sync engine and the backup, which take every profile's. */
  listAll(): Promise<readonly Subscription[]>;
  get(id: string): Promise<Subscription | undefined>;
  /** The one for this channel, so following twice follows once. */
  forChannel(userId: UserId, connectionId: ConnectionId, externalId: string): Promise<Subscription | undefined>;
  put(subscription: Subscription): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface FavoriteChannelRepository {
  list(userId: UserId): Promise<readonly FavoriteChannel[]>;
  /** For the sync engine and the backup, which take every profile's. */
  listAll(): Promise<readonly FavoriteChannel[]>;
  get(id: string): Promise<FavoriteChannel | undefined>;
  /** The one for this channel, so choosing it twice chooses it once. */
  forChannel(userId: UserId, connectionId: ConnectionId, externalId: string): Promise<FavoriteChannel | undefined>;
  put(favorite: FavoriteChannel): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Where a profile got to in one thing it watched, kept by the app for a source
 * that keeps no watch status of its own (v9). Account-wide, as the lists are:
 * journaled, carried to your own server, written into backups — and keyed by
 * what it is apart from any source (`watchIdentity`), so every device and
 * every copy of it on the account's sources shares one row.
 */
export interface WatchProgress {
  /** `${userId}/${identityHash(identity)}`: the same on every device. */
  readonly id: string;
  readonly userId: UserId;
  readonly identity: string;
  readonly externalIds?: ExternalIds;
  /** Bumped by "mark as unwatched": the later round wins whole (spec §10). */
  readonly round: number;
  readonly watched: boolean;
  /** Absent rather than nought: nothing to resume from. */
  readonly positionMs?: number;
  readonly durationMs?: number;
  /** The item as it was last played, without a watch state of its own — for what screens list. */
  readonly item?: MediaItem;
  /** ISO 8601. For ordering what is shown, never for deciding a conflict. */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface WatchProgressRepository {
  get(id: string): Promise<WatchProgress | undefined>;
  /** Those of these ids there are, for laying over a list. */
  getMany(ids: readonly string[]): Promise<readonly WatchProgress[]>;
  /** A profile's, the most recently updated first. */
  list(userId: UserId): Promise<readonly WatchProgress[]>;
  /** For the sync engine and the backup, which take every profile's. */
  listAll(): Promise<readonly WatchProgress[]>;
  put(progress: WatchProgress): Promise<void>;
  remove(id: string): Promise<void>;
}

/** One of the account's own settings (v9): the same for every profile and device. */
export interface AccountSetting {
  readonly name: string;
  readonly value: unknown;
  readonly version: number;
}

/**
 * The account's settings. Journaled — they travel with the account — but no
 * profile's: deleting one takes none of them. All of them go when the device
 * changes account, as the account's other rows do.
 */
export interface AccountSettingsRepository {
  get(name: string): Promise<AccountSetting | undefined>;
  list(): Promise<readonly AccountSetting[]>;
  /** A value that is already the stored one writes nothing. */
  put(setting: AccountSetting): Promise<void>;
  remove(name: string): Promise<void>;
  /** Unjournaled: the account they belonged to is leaving the device. */
  clear(): Promise<void>;
}

/**
 * What a metadata adapter said one item is (v10): its catalogue ids, or that
 * nothing matched closely enough. For a series' seasons and episodes, the
 * series is asked, under its own key. Device state, like the media cache:
 * never journaled, never synced, never in a backup.
 */
export interface KnownIdentity {
  readonly key: GlobalMediaKey;
  /** Absent: asked, and nothing close enough was found — asked again after a while. */
  readonly externalIds?: ExternalIds;
  readonly resolvedAt: number;
}

export interface IdentityRepository {
  getMany(userId: UserId, keys: readonly GlobalMediaKey[]): Promise<readonly KnownIdentity[]>;
  /** Skipped when the profile or the connection is gone. */
  put(userId: UserId, known: KnownIdentity): Promise<void>;
  /** Everything known of a connection's items — or of one profile's use of it: its values changed, and its ids may now mean others. */
  purge(connectionId: ConnectionId, userId?: UserId): Promise<void>;
}

export interface PlaylistRepository {
  list(userId: UserId): Promise<readonly Playlist[]>;
  listAll(): Promise<readonly Playlist[]>;
  get(id: string): Promise<Playlist | undefined>;
  put(playlist: Playlist): Promise<void>;
  remove(id: string): Promise<void>;
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
export type JournalEntity =
  | 'user'
  | 'userPin'
  | 'preferences'
  | 'connection'
  | 'connectionProfileValues'
  | 'subscription'
  | 'playlist'
  | 'favoriteChannel'
  | 'watchProgress'
  | 'accountSetting';

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
  readonly downloads: DownloadRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly favoriteChannels: FavoriteChannelRepository;
  readonly playlists: PlaylistRepository;
  readonly watchProgress: WatchProgressRepository;
  readonly accountSettings: AccountSettingsRepository;
  readonly identities: IdentityRepository;
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

/**
 * Picture in picture where the *platform* provides it rather than an engine:
 * Android, which shrinks the whole activity, so every player has it there.
 */
export interface PictureInPicture {
  available(): boolean;
  /** Let the system shrink the app by itself when it is left. */
  setAutoEnter(on: boolean): void;
  /** Told whenever the app enters or leaves that window. */
  subscribe(listener: (inPictureInPicture: boolean) => void): () => void;
}

/**
 * The screen's own brightness, 0 to 1, for the slider down an edge of the
 * player. `undefined` from `get` means the device will not say, and the
 * slider starts from the middle.
 */
export interface ScreenBrightness {
  get(): Promise<number | undefined>;
  set(value: number): Promise<void>;
  /** Back to the system's, when the player closes. */
  restore(): Promise<void>;
}

/**
 * The device's own media volume, 0 to 1, for the slider down an edge of the
 * player: the one its side buttons move, not a second one inside an engine.
 * `undefined` from `get` means there is none an app may set — a browser, a
 * television — and the player keeps to its engine's own.
 */
export interface SystemVolume {
  get(): Promise<number | undefined>;
  set(value: number): Promise<void>;
  /** Told whenever it changes, by any hand: the side buttons, a headset, the control centre. */
  subscribe(listener: (volume: number) => void): () => void;
  /** While the player is open. On iPhone the system's own volume banner stays away meanwhile. */
  attach(): Promise<void>;
  release(): Promise<void>;
}

/**
 * The Apple TV remote's Menu button, kept for the app while a screen needs it
 * — the player, whose layers close one by one before it does. A pushed screen
 * would otherwise be popped by UIKit before the app heard the press. On a
 * phone, Android TV or a page, Back reaches the app already, and this does
 * nothing.
 */
export interface TvMenu {
  /** Menu reaches `BackHandler` until the returned function is called. Counted: the last one released gives it back. */
  hold(): () => void;
  /** Takes it again after a screen came or went, which re-arms UIKit's own. */
  refresh(): void;
}

/** Which ways the screen may turn: upright, as the app is laid out, or any way — a film fills a phone on its side. */
export interface ScreenOrientationControl {
  upright(): Promise<void>;
  free(): Promise<void>;
  /** On its side, and held there: a film fills the screen without the viewer holding the phone level. */
  landscape(): Promise<void>;
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
  /**
   * Whether this device can hand a file out and take one in at all. A TV
   * cannot — no share sheet, no files, no picker — so it offers neither.
   */
  readonly available: boolean;
  save(name: string, bytes: Uint8Array): Promise<'saved' | 'cancelled'>;
  /** Nothing when the user backed out. */
  pick(): Promise<PickedFile | undefined>;
}
