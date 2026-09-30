import { AppError, DEFAULT_MAX_PROFILES, userId as toUserId, type AppUser, type UserId } from '@sc/api';

import type { IdGenerator, LocalDatabase, StoredAccount } from './ports';
import { removeProfileIn } from './removal';
import type { SecretJanitor } from './secrets';
import type { SessionService } from './session';
import { toAppUser } from './users';

const MAX_NAME_LENGTH = 30;

/** How many profiles an account may hold: ten on this device, or what your server says. */
export function profileLimitOf(account: StoredAccount | undefined): number {
  return account?.kind === 'server' ? account.maxProfiles : DEFAULT_MAX_PROFILES;
}

export interface ProfileService {
  list(): Promise<readonly AppUser[]>;
  get(id: UserId): Promise<AppUser | undefined>;
  /**
   * The first profile on a device also becomes its default. Refused at the
   * account's limit — a local copy kept on signing out may hold more, and
   * takes no new one until there are fewer.
   */
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
        const count = (await tx.users.list()).length;
        const limit = profileLimitOf(await tx.account.get());
        if (count >= limit) {
          throw new AppError('INVALID_STATE', `Your account holds up to ${limit} profiles.`, { retry: 'never' });
        }
        const isFirst = count === 0;
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
      const removed = await db.transaction((tx) => removeProfileIn(tx, id, { allowLast: false }));
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
