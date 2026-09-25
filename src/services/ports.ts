import type {
  Connection,
  ConnectionId,
  ConnectionOwner,
  Credentials,
  CredentialsRef,
  PluginId,
  UserId,
} from '@sc/api';

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
  /** Removes the user and — like the database cascade — every connection it owns. */
  delete(id: UserId): Promise<void>;
}

export interface ConnectionRepository {
  list(owner: ConnectionOwner): Promise<readonly Connection[]>;
  get(id: ConnectionId): Promise<Connection | undefined>;
  insert(connection: Connection): Promise<void>;
  update(connection: Connection): Promise<void>;
  delete(id: ConnectionId): Promise<void>;
}

/** Per plugin, on this device. A plugin missing here is neither enabled nor per-profile. */
export interface DevicePluginState {
  readonly enabled: boolean;
  readonly perProfile: boolean;
}

export interface DeviceSettings {
  readonly defaultUserId?: UserId;
  readonly plugins: Readonly<Partial<Record<PluginId, DevicePluginState>>>;
}

export interface DeviceSettingsRepository {
  get(): Promise<DeviceSettings>;
  update(change: (current: DeviceSettings) => DeviceSettings): Promise<DeviceSettings>;
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
}
