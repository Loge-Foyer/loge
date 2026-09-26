import type { Connection, ConnectionId, UserId } from '@sc/api';

import type {
  ConnectionRepository,
  DeviceSettings,
  DeviceSettingsRepository,
  PreferencesRepository,
  ProfileValues,
  StoredUser,
  UserPreferences,
  UserRepository,
} from '@/services/ports';

export interface MemoryStores {
  readonly users: UserRepository;
  readonly connections: ConnectionRepository;
  readonly deviceSettings: DeviceSettingsRepository;
  readonly preferences: PreferencesRepository;
}

/**
 * Stand-ins for the real database — SQLite on native, IndexedDB on web — that
 * keep its rules, so the services cannot tell the difference. What a profile
 * owns goes with the profile, and a connection's per-profile values go with
 * the connection, as the cascades will do. Nothing survives a reload.
 */
export function createMemoryStores(): MemoryStores {
  const users = new Map<UserId, StoredUser>();
  const connections = new Map<ConnectionId, Connection>();
  const profileValues = new Map<`${ConnectionId}|${UserId}`, { connectionId: ConnectionId; userId: UserId; values: ProfileValues }>();
  const preferences = new Map<UserId, UserPreferences>();
  let settings: DeviceSettings = { plugins: {} };

  const requireAbsent = <K, V>(map: Map<K, V>, key: K) => {
    if (map.has(key)) throw new Error(`Duplicate key ${String(key)}`);
  };
  const requirePresent = <K, V>(map: Map<K, V>, key: K) => {
    if (!map.has(key)) throw new Error(`Missing key ${String(key)}`);
  };
  const dropRows = (matches: (row: { connectionId: ConnectionId; userId: UserId }) => boolean) => {
    for (const [key, row] of profileValues) if (matches(row)) profileValues.delete(key);
  };

  return {
    users: {
      list: async () => [...users.values()],
      get: async (id) => users.get(id),
      insert: async (user) => {
        requireAbsent(users, user.id);
        users.set(user.id, user);
      },
      update: async (user) => {
        requirePresent(users, user.id);
        users.set(user.id, user);
      },
      delete: async (id) => {
        users.delete(id);
        dropRows((row) => row.userId === id);
        preferences.delete(id);
      },
    },
    connections: {
      list: async () => [...connections.values()],
      get: async (id) => connections.get(id),
      insert: async (connection) => {
        requireAbsent(connections, connection.id);
        connections.set(connection.id, connection);
      },
      update: async (connection) => {
        requirePresent(connections, connection.id);
        connections.set(connection.id, connection);
      },
      delete: async (id) => {
        connections.delete(id);
        dropRows((row) => row.connectionId === id);
      },
      profileValues: async (id) =>
        new Map([...profileValues.values()].filter((row) => row.connectionId === id).map((row) => [row.userId, row.values])),
      valuesOfProfile: async (userId) =>
        new Map([...profileValues.values()].filter((row) => row.userId === userId).map((row) => [row.connectionId, row.values])),
      putProfileValues: async (connectionId, userId, values) => {
        requirePresent(connections, connectionId);
        requirePresent(users, userId);
        profileValues.set(`${connectionId}|${userId}`, { connectionId, userId, values });
      },
      deleteProfileValues: async (connectionId, userId) => {
        profileValues.delete(`${connectionId}|${userId}`);
      },
    },
    deviceSettings: {
      get: async () => settings,
      update: async (change) => {
        settings = change(settings);
        return settings;
      },
    },
    preferences: {
      get: async (userId) => preferences.get(userId) ?? {},
      update: async (userId, change) => {
        requirePresent(users, userId);
        const next = change(preferences.get(userId) ?? {});
        preferences.set(userId, next);
        return next;
      },
    },
  };
}
