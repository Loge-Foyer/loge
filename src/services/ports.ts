import type {
  CancelSignal,
  Connection,
  ConnectionId,
  ConnectionValues,
  Credentials,
  CredentialsRef,
  NetworkKind,
  PluginId,
  UserId,
} from '@sc/api';

import type { HomeLayout } from './home-layout';

// What the services need from storage and the device. Everything is async so
// today's in-memory implementations can be replaced by SQLite (native) and
// IndexedDB (web) without touching a service.

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

/** Keychain on native, encrypted IndexedDB on web — in memory for now. */
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
