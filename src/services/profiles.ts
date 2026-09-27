import { userId as toUserId, type AppUser, type CredentialsRef, type UserId } from '@sc/api';

import type { IdGenerator, LocalDatabase } from './ports';
import type { SecretJanitor } from './secrets';
import type { SessionService } from './session';
import { sessionRef } from './sessions';
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
  db: LocalDatabase;
  janitor: SecretJanitor;
  session: SessionService;
  ids: IdGenerator;
  /** The profile is gone: whatever runs for it can stop. */
  onRemoved?: (id: UserId) => void;
}): ProfileService {
  const { db, janitor, session, ids, onRemoved } = deps;

  const cleanName = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === '') throw new Error('A profile needs a name.');
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new Error(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
    }
    return trimmed;
  };

  return {
    list: async () => (await db.users.list()).map(toAppUser),
    get: async (id) => {
      const user = await db.users.get(id);
      return user && toAppUser(user);
    },
    create: async (name) => {
      const user = { id: toUserId(ids.next()), name: cleanName(name) };
      await db.transaction(async (tx) => {
        const isFirst = (await tx.users.list()).length === 0;
        await tx.users.insert(user);
        if (isFirst) await tx.deviceSettings.update((current) => ({ ...current, defaultUserId: user.id }));
      });
      return toAppUser(user);
    },
    rename: async (id, name) => {
      const user = await db.users.get(id);
      if (!user) throw new Error(`Unknown profile ${id}`);
      await db.users.update({ ...user, name: cleanName(name) });
    },
    remove: async (id) => {
      const removed = await db.transaction(async (tx) => {
        const all = await tx.users.list();
        const user = all.find((candidate) => candidate.id === id);
        if (!user) return false;
        if (all.length === 1) throw new Error('The last profile cannot be deleted.');
        const own = await tx.connections.valuesOfProfile(id);
        const connections = await tx.connections.list();
        // The cascade takes everything the profile owns. Its secrets are not in
        // the database, so they are queued: its own sign-ins, its PIN, its sessions.
        await tx.users.delete(id);
        await tx.deviceSettings.update((current) => {
          if (current.defaultUserId !== id) return current;
          const { defaultUserId: _deleted, ...rest } = current;
          return rest;
        });
        await tx.staleSecrets.add([
          ...[...own.values()].map((values) => values.credentialsRef).filter((ref): ref is CredentialsRef => ref !== undefined),
          ...(user.pinCredentialRef ? [user.pinCredentialRef] : []),
          ...connections.map((connection) => sessionRef(connection.id, id)),
        ]);
        return true;
      });
      if (!removed) return;
      await janitor.drain();
      onRemoved?.(id);
      session.forget(id);
    },
    defaultUserId: async () => (await db.deviceSettings.get()).defaultUserId,
    setDefault: async (id) => {
      await db.deviceSettings.update((current) => ({ ...current, defaultUserId: id }));
    },
  };
}
