import { userId as toUserId, type AppUser, type UserId } from '@sc/api';

import type {
  ConnectionRepository,
  DeviceSettingsRepository,
  IdGenerator,
  SecureCredentialStore,
  UserRepository,
} from './ports';
import type { SessionService } from './session';
import type { Sessions } from './sessions';
import { toAppUser } from './users';

const MAX_NAME_LENGTH = 30;

export interface ProfileService {
  list(): Promise<readonly AppUser[]>;
  get(id: UserId): Promise<AppUser | undefined>;
  /** The first profile on a device also becomes its default. */
  create(name: string): Promise<AppUser>;
  rename(id: UserId, name: string): Promise<void>;
  /** Everything the profile owns goes with it. The last profile cannot be deleted. */
  remove(id: UserId): Promise<void>;
  defaultUserId(): Promise<UserId | undefined>;
  setDefault(id: UserId): Promise<void>;
}

export function createProfileService(deps: {
  users: UserRepository;
  connections: ConnectionRepository;
  credentials: SecureCredentialStore;
  sessions: Sessions;
  deviceSettings: DeviceSettingsRepository;
  session: SessionService;
  ids: IdGenerator;
  /** The profile is gone: whatever runs for it can stop. */
  onRemoved?: (id: UserId) => void;
}): ProfileService {
  const { users, connections, credentials, sessions, deviceSettings, session, ids, onRemoved } = deps;

  const cleanName = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === '') throw new Error('A profile needs a name.');
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new Error(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
    }
    return trimmed;
  };

  return {
    list: async () => (await users.list()).map(toAppUser),
    get: async (id) => {
      const user = await users.get(id);
      return user && toAppUser(user);
    },
    create: async (name) => {
      const isFirst = (await users.list()).length === 0;
      const user = { id: toUserId(ids.next()), name: cleanName(name) };
      await users.insert(user);
      if (isFirst) await deviceSettings.update((current) => ({ ...current, defaultUserId: user.id }));
      return toAppUser(user);
    },
    rename: async (id, name) => {
      const user = await users.get(id);
      if (!user) throw new Error(`Unknown profile ${id}`);
      await users.update({ ...user, name: cleanName(name) });
    },
    remove: async (id) => {
      const all = await users.list();
      const user = all.find((candidate) => candidate.id === id);
      if (!user) return;
      if (all.length === 1) throw new Error('The last profile cannot be deleted.');

      // Secrets are not in the database, so its cascade cannot reach them.
      const own = await connections.valuesOfProfile(id);
      for (const values of own.values()) {
        if (values.credentialsRef) await credentials.delete(values.credentialsRef);
      }
      for (const connection of await connections.list()) await sessions.forget(connection.id, id);
      onRemoved?.(id);
      if (user.pinCredentialRef) await credentials.delete(user.pinCredentialRef);

      await users.delete(id);
      await deviceSettings.update((current) => {
        if (current.defaultUserId !== id) return current;
        const { defaultUserId: _deleted, ...rest } = current;
        return rest;
      });
      session.forget(id);
    },
    defaultUserId: async () => (await deviceSettings.get()).defaultUserId,
    setDefault: async (id) => {
      await deviceSettings.update((current) => ({ ...current, defaultUserId: id }));
    },
  };
}
