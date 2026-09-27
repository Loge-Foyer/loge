import { credentialsRef, type UserId } from '@sc/api';

import type { Clock, IdGenerator, LocalDatabase, SecureCredentialStore } from './ports';
import type { SecretJanitor } from './secrets';

// A profile PIN keeps children out of adult profiles; it is not an account
// password. It is kept as typed — in the credential store, never the database —
// and the real protection is the throttle below.
const PIN = /^\d{4}$/;
const ATTEMPTS_BEFORE_LOCKOUT = 5;
const LOCKOUT_MS = 30_000;

export type PinCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'wrong'; readonly attemptsLeft: number }
  | { readonly ok: false; readonly reason: 'locked'; readonly retryInMs: number };

export interface PinService {
  isWellFormed(pin: string): boolean;
  verify(userId: UserId, pin: string): Promise<PinCheck>;
  /** Only for a profile without a PIN. */
  create(userId: UserId, pin: string): Promise<void>;
  change(userId: UserId, current: string, next: string): Promise<PinCheck>;
  remove(userId: UserId, current: string): Promise<PinCheck>;
}

interface Throttle {
  failures: number;
  lockedUntil: number;
}

export function createPinService(deps: {
  db: LocalDatabase;
  credentials: SecureCredentialStore;
  janitor: SecretJanitor;
  ids: IdGenerator;
  clock: Clock;
}): PinService {
  const { db, credentials, janitor, ids, clock } = deps;
  // In memory on purpose: a persisted lockout would hand anyone holding the
  // device a way to lock the owner out of their own profile.
  const throttles = new Map<UserId, Throttle>();

  const requireUser = async (userId: UserId) => {
    const user = await db.users.get(userId);
    if (!user) throw new Error(`Unknown profile ${userId}`);
    return user;
  };

  const assertWellFormed = (pin: string) => {
    if (!PIN.test(pin)) throw new Error('A PIN is exactly four digits.');
  };

  const verify = async (userId: UserId, pin: string): Promise<PinCheck> => {
    const now = clock.now();
    const throttle = throttles.get(userId) ?? { failures: 0, lockedUntil: 0 };
    if (throttle.lockedUntil > now) {
      return { ok: false, reason: 'locked', retryInMs: throttle.lockedUntil - now };
    }

    const user = await requireUser(userId);
    const stored = user.pinCredentialRef ? await credentials.read(user.pinCredentialRef) : undefined;
    // No stored PIN — none was set, or the credential store lost it — lets the
    // owner in: for a child lock, locking the owner out for good is worse.
    if (stored?.pin === undefined || stored.pin === pin) {
      throttles.delete(userId);
      return { ok: true };
    }

    const failures = throttle.failures + 1;
    if (failures >= ATTEMPTS_BEFORE_LOCKOUT) {
      throttles.set(userId, { failures: 0, lockedUntil: now + LOCKOUT_MS });
      return { ok: false, reason: 'locked', retryInMs: LOCKOUT_MS };
    }
    throttles.set(userId, { failures, lockedUntil: 0 });
    return { ok: false, reason: 'wrong', attemptsLeft: ATTEMPTS_BEFORE_LOCKOUT - failures };
  };

  // Like every secret, a new PIN gets a new ref, and the old one is deleted
  // only once the profile points at the new one.
  const write = async (userId: UserId, pin: string) => {
    assertWellFormed(pin);
    await requireUser(userId);
    const fresh = credentialsRef(ids.next());
    await credentials.write(fresh, { pin });
    try {
      await db.transaction(async (tx) => {
        const user = await tx.users.get(userId);
        if (!user) throw new Error(`Unknown profile ${userId}`);
        await tx.users.update({ ...user, pinCredentialRef: fresh });
        if (user.pinCredentialRef) await tx.staleSecrets.add([user.pinCredentialRef]);
      });
    } catch (error) {
      await credentials.delete(fresh).catch(() => undefined);
      throw error;
    }
    await janitor.drain();
  };

  return {
    isWellFormed: (pin) => PIN.test(pin),
    verify,
    create: async (userId, pin) => {
      const user = await requireUser(userId);
      if (user.pinCredentialRef) throw new Error('This profile already has a PIN.');
      await write(userId, pin);
    },
    change: async (userId, current, next) => {
      assertWellFormed(next);
      const check = await verify(userId, current);
      if (check.ok) await write(userId, next);
      return check;
    },
    remove: async (userId, current) => {
      const check = await verify(userId, current);
      if (!check.ok) return check;
      await db.transaction(async (tx) => {
        const found = await tx.users.get(userId);
        if (!found?.pinCredentialRef) return;
        const { pinCredentialRef, ...user } = found;
        await tx.users.update(user);
        await tx.staleSecrets.add([pinCredentialRef]);
      });
      await janitor.drain();
      return check;
    },
  };
}
