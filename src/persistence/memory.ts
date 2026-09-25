import type { Connection, ConnectionId, ConnectionOwner, UserId } from '@sc/api';

import type {
  ConnectionRepository,
  DeviceSettings,
  DeviceSettingsRepository,
  StoredUser,
  UserRepository,
} from '@/services/ports';

export interface MemoryStores {
  readonly users: UserRepository;
  readonly connections: ConnectionRepository;
  readonly deviceSettings: DeviceSettingsRepository;
}

/**
 * Stand-ins for the real database — SQLite on native, IndexedDB on web — that
 * keep its rules, so the services cannot tell the difference: a user's
 * connections go with the user, as the cascade will do. Nothing survives a
 * reload.
 */
export function createMemoryStores(): MemoryStores {
  const users = new Map<UserId, StoredUser>();
  const connections = new Map<ConnectionId, Connection>();
  let settings: DeviceSettings = { plugins: {} };

  const ownedBy = (connection: Connection, owner: ConnectionOwner) =>
    owner.scope === 'device'
      ? connection.owner.scope === 'device'
      : connection.owner.scope === 'user' && connection.owner.userId === owner.userId;

  const requireAbsent = <K, V>(map: Map<K, V>, key: K) => {
    if (map.has(key)) throw new Error(`Duplicate key ${String(key)}`);
  };
  const requirePresent = <K, V>(map: Map<K, V>, key: K) => {
    if (!map.has(key)) throw new Error(`Missing key ${String(key)}`);
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
        for (const connection of connections.values()) {
          if (connection.owner.scope === 'user' && connection.owner.userId === id) {
            connections.delete(connection.id);
          }
        }
      },
    },
    connections: {
      list: async (owner) => [...connections.values()].filter((connection) => ownedBy(connection, owner)),
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
      },
    },
    deviceSettings: {
      get: async () => settings,
      update: async (change) => {
        settings = change(settings);
        return settings;
      },
    },
  };
}
