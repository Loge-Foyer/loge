import type { Repositories } from '@/services/ports';

type Run = <T>(work: (repositories: Repositories) => Promise<T>) => Promise<T>;

/**
 * The repositories as a service calls them outside a transaction: a read runs
 * as it is, and each write is a transaction of its own, journal entry and all.
 */
export function standaloneRepositories(read: Run, write: Run): Repositories {
  return {
    users: {
      list: () => read((r) => r.users.list()),
      get: (id) => read((r) => r.users.get(id)),
      insert: (user) => write((r) => r.users.insert(user)),
      update: (user) => write((r) => r.users.update(user)),
      delete: (id) => write((r) => r.users.delete(id)),
    },
    connections: {
      list: () => read((r) => r.connections.list()),
      get: (id) => read((r) => r.connections.get(id)),
      insert: (connection) => write((r) => r.connections.insert(connection)),
      update: (connection) => write((r) => r.connections.update(connection)),
      delete: (id) => write((r) => r.connections.delete(id)),
      profileValues: (id) => read((r) => r.connections.profileValues(id)),
      valuesOfProfile: (userId) => read((r) => r.connections.valuesOfProfile(userId)),
      putProfileValues: (id, userId, values) => write((r) => r.connections.putProfileValues(id, userId, values)),
      deleteProfileValues: (id, userId) => write((r) => r.connections.deleteProfileValues(id, userId)),
    },
    deviceSettings: {
      get: () => read((r) => r.deviceSettings.get()),
      update: (change) => write((r) => r.deviceSettings.update(change)),
    },
    preferences: {
      get: (userId) => read((r) => r.preferences.get(userId)),
      update: (userId, change) => write((r) => r.preferences.update(userId, change)),
    },
    mediaCache: {
      list: (...args) => read((r) => r.mediaCache.list(...args)),
      putList: (...args) => write((r) => r.mediaCache.putList(...args)),
      removeList: (...args) => write((r) => r.mediaCache.removeList(...args)),
      detail: (...args) => read((r) => r.mediaCache.detail(...args)),
      putDetail: (...args) => write((r) => r.mediaCache.putDetail(...args)),
      removeDetail: (...args) => write((r) => r.mediaCache.removeDetail(...args)),
      purge: (...args) => write((r) => r.mediaCache.purge(...args)),
      prune: (...args) => write((r) => r.mediaCache.prune(...args)),
    },
    staleSecrets: {
      add: (refs) => write((r) => r.staleSecrets.add(refs)),
      list: () => read((r) => r.staleSecrets.list()),
      remove: (refs) => write((r) => r.staleSecrets.remove(refs)),
    },
  };
}
