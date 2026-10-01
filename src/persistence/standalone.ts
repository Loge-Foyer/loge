import type { Logger, Repositories } from '@/services/ports';

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
      value: (userId, connectionId, key, fingerprint) => read((r) => r.mediaCache.value(userId, connectionId, key, fingerprint)),
      putValue: (...args) => write((r) => r.mediaCache.putValue(...args)),
      purge: (...args) => write((r) => r.mediaCache.purge(...args)),
      prune: (...args) => write((r) => r.mediaCache.prune(...args)),
    },
    staleSecrets: {
      add: (refs) => write((r) => r.staleSecrets.add(refs)),
      list: () => read((r) => r.staleSecrets.list()),
      remove: (refs) => write((r) => r.staleSecrets.remove(refs)),
    },
    account: {
      get: () => read((r) => r.account.get()),
      put: (account) => write((r) => r.account.put(account)),
      sync: () => read((r) => r.account.sync()),
      putSync: (state) => write((r) => r.account.putSync(state)),
      clear: () => write((r) => r.account.clear()),
    },
    backupState: {
      get: (id) => read((r) => r.backupState.get(id)),
      put: (state) => write((r) => r.backupState.put(state)),
    },
    watchStatus: {
      get: (userId, key) => read((r) => r.watchStatus.get(userId, key)),
      list: (userId) => read((r) => r.watchStatus.list(userId)),
      put: (userId, entry) => write((r) => r.watchStatus.put(userId, entry)),
      prune: (before) => write((r) => r.watchStatus.prune(before)),
    },
    subscriptions: {
      list: (userId) => read((r) => r.subscriptions.list(userId)),
      listAll: () => read((r) => r.subscriptions.listAll()),
      get: (id) => read((r) => r.subscriptions.get(id)),
      forChannel: (userId, connectionId, externalId) => read((r) => r.subscriptions.forChannel(userId, connectionId, externalId)),
      put: (subscription) => write((r) => r.subscriptions.put(subscription)),
      remove: (id) => write((r) => r.subscriptions.remove(id)),
    },
    playlists: {
      list: (userId) => read((r) => r.playlists.list(userId)),
      listAll: () => read((r) => r.playlists.listAll()),
      get: (id) => read((r) => r.playlists.get(id)),
      put: (playlist) => write((r) => r.playlists.put(playlist)),
      remove: (id) => write((r) => r.playlists.remove(id)),
    },
    downloads: {
      get: (id) => read((r) => r.downloads.get(id)),
      forItem: (userId, key) => read((r) => r.downloads.forItem(userId, key)),
      list: (userId) => read((r) => r.downloads.list(userId)),
      listAll: () => read((r) => r.downloads.listAll()),
      put: (entry) => write((r) => r.downloads.put(entry)),
      remove: (id) => write((r) => r.downloads.remove(id)),
    },
    outbox: {
      add: (userId, report) => write((r) => r.outbox.add(userId, report)),
      list: () => read((r) => r.outbox.list()),
      pendingKeys: (userId) => read((r) => r.outbox.pendingKeys(userId)),
      remove: (seq) => write((r) => r.outbox.remove(seq)),
      defer: (seq, attempts, notBefore) => write((r) => r.outbox.defer(seq, attempts, notBefore)),
      clear: () => write((r) => r.outbox.clear()),
    },
    journal: {
      entries: (after, limit) => read((r) => r.journal.entries(after, limit)),
      head: () => read((r) => r.journal.head()),
      count: (after) => read((r) => r.journal.count(after)),
      announce: (changes) => write((r) => r.journal.announce(changes)),
      prune: (through) => write((r) => r.journal.prune(through)),
    },
  };
}

/** Who wants to hear that the journal grew. A listener that throws never fails the write it heard about. */
export function journalListeners(log: Logger) {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: () => {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          log.warn('storage', 'A journal listener failed', { error: String(error) });
        }
      }
    },
  };
}
