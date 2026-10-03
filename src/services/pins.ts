import { AppError, credentialsRef, type Credentials, type CredentialsRef, type UserId } from '@loge/api';

import { devicePinOf, withDevicePin, withoutDevicePin } from './device-pins';
import type { OwnerCheck, OwnerVerdict } from './owner-check';
import type { Clock, IdGenerator, LocalDatabase, Repositories, SecureCredentialStore, StoredUser } from './ports';
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

/**
 * Where this device takes a profile's PIN from: the account's — one PIN, kept
 * with the account, asked for on every device that follows it — or its own,
 * which may be none at all. A personal phone without one, the family's TV
 * with one.
 */
export type PinScope = 'account' | 'device';

export const PIN_SCOPES: readonly PinScope[] = ['account', 'device'];

/** How a profile's PIN stands on this device. Never the PIN, nor where it is kept. */
export interface PinStatus {
  readonly scope: PinScope;
  /** Whether this device asks for one. */
  readonly asks: boolean;
  /** Whether the account keeps one: what the devices that follow it ask for. */
  readonly accountPin: boolean;
}

export interface PinService {
  isWellFormed(pin: string): boolean;
  status(userId: UserId): Promise<PinStatus>;
  /** Against the PIN this device asks for. */
  verify(userId: UserId, pin: string): Promise<PinCheck>;
  /** Only where none is asked for, in the scope this device takes it from. */
  create(userId: UserId, pin: string): Promise<void>;
  change(userId: UserId, current: string, next: string): Promise<PinCheck>;
  /** On this device's own, it goes and this device still decides: it asks for none. */
  remove(userId: UserId, current: string): Promise<PinCheck>;
  /**
   * Where this device takes the PIN from. Whoever holds the device must give
   * the PIN it asks for now, if it asks for one — so nobody takes a profile
   * out of the account's PIN on a device they merely picked up. This device's
   * own starts as none; the account's stays as it is, for the devices that
   * follow it and for coming back to it.
   */
  setScope(userId: UserId, scope: PinScope, current?: string): Promise<PinCheck>;
  /** Forgot PIN: the owner is re-verified — with `proof`, when the account asks for one — and only then does the PIN this device asks for go. */
  forgot(userId: UserId, proof?: Credentials): Promise<OwnerVerdict>;
}

interface Throttle {
  failures: number;
  lockedUntil: number;
}

/** The PIN this device asks for, where it comes from, and the profile it is for. */
interface Effective {
  readonly user: StoredUser;
  readonly scope: PinScope;
  readonly ref: CredentialsRef | undefined;
}

const changedMeanwhile = () => new AppError('INVALID_STATE', 'The PIN changed meanwhile. Try again.', { retry: 'never' });

export function createPinService(deps: {
  db: LocalDatabase;
  credentials: SecureCredentialStore;
  janitor: SecretJanitor;
  ids: IdGenerator;
  clock: Clock;
  owner: OwnerCheck;
}): PinService {
  const { db, credentials, janitor, ids, clock, owner } = deps;
  // In memory on purpose: a persisted lockout would hand anyone holding the
  // device a way to lock the owner out of their own profile. One per profile,
  // whichever PIN it is asked against.
  const throttles = new Map<UserId, Throttle>();

  // Read through `db`, or through a transaction's `tx`, which must see what it is about to change.
  const effectiveIn = async (repos: Pick<Repositories, 'users' | 'deviceSettings'>, userId: UserId): Promise<Effective> => {
    const user = await repos.users.get(userId);
    if (!user) throw new Error(`Unknown profile ${userId}`);
    const own = devicePinOf((await repos.deviceSettings.get()).pins, userId);
    return own ? { user, scope: 'device', ref: own.ref } : { user, scope: 'account', ref: user.pinCredentialRef };
  };

  // Checked, then written: another tab, or a sync, may change it in between.
  // A changed PIN always has a new ref, so the ref says whether it did.
  const assertUnchanged = (now: Effective, checked: Pick<Effective, 'scope' | 'ref'>) => {
    if (now.scope !== checked.scope || now.ref !== checked.ref) throw changedMeanwhile();
  };

  const assertWellFormed = (pin: string) => {
    if (!PIN.test(pin)) throw new Error('A PIN is exactly four digits.');
  };

  /** A guess, counted against the throttle; with the PIN it was checked against. */
  const check = async (userId: UserId, pin: string): Promise<{ readonly result: PinCheck; readonly against?: Effective }> => {
    const now = clock.now();
    const throttle = throttles.get(userId) ?? { failures: 0, lockedUntil: 0 };
    if (throttle.lockedUntil > now) {
      return { result: { ok: false, reason: 'locked', retryInMs: throttle.lockedUntil - now } };
    }

    const against = await effectiveIn(db, userId);
    const stored = against.ref ? await credentials.read(against.ref) : undefined;
    // No stored PIN — none was set, or the credential store lost it — lets the
    // owner in: for a child lock, locking the owner out for good is worse.
    if (stored?.pin === undefined || stored.pin === pin) {
      throttles.delete(userId);
      return { result: { ok: true }, against };
    }

    const failures = throttle.failures + 1;
    if (failures >= ATTEMPTS_BEFORE_LOCKOUT) {
      throttles.set(userId, { failures: 0, lockedUntil: now + LOCKOUT_MS });
      return { result: { ok: false, reason: 'locked', retryInMs: LOCKOUT_MS }, against };
    }
    throttles.set(userId, { failures, lockedUntil: 0 });
    return { result: { ok: false, reason: 'wrong', attemptsLeft: ATTEMPTS_BEFORE_LOCKOUT - failures }, against };
  };

  // Like every secret, a new PIN gets a new ref, and the old one is deleted
  // only once nothing points at it. The account's is the profile's and
  // journaled; this device's own is a device setting, and goes nowhere.
  const write = async (userId: UserId, pin: string, checked: Effective) => {
    assertWellFormed(pin);
    const fresh = credentialsRef(ids.next());
    await credentials.write(fresh, { pin });
    try {
      await db.transaction(async (tx) => {
        const now = await effectiveIn(tx, userId);
        assertUnchanged(now, checked);
        if (now.scope === 'account') await tx.users.update({ ...now.user, pinCredentialRef: fresh });
        else await tx.deviceSettings.update((settings) => withDevicePin(settings, userId, { ref: fresh }));
        if (now.ref) await tx.staleSecrets.add([now.ref]);
      });
    } catch (error) {
      await credentials.delete(fresh).catch(() => undefined);
      throw error;
    }
    await janitor.drain();
  };

  const clear = async (userId: UserId, checked?: Effective) => {
    await db.transaction(async (tx) => {
      const now = await effectiveIn(tx, userId);
      if (checked) assertUnchanged(now, checked);
      if (!now.ref) return;
      if (now.scope === 'account') {
        const { pinCredentialRef: _cleared, ...user } = now.user;
        await tx.users.update(user);
      } else {
        // This device still decides, and asks for none: the account's PIN does not come back by itself.
        await tx.deviceSettings.update((settings) => withDevicePin(settings, userId, {}));
      }
      await tx.staleSecrets.add([now.ref]);
    });
    await janitor.drain();
  };

  return {
    isWellFormed: (pin) => PIN.test(pin),
    status: async (userId) => {
      const found = await effectiveIn(db, userId);
      return { scope: found.scope, asks: found.ref !== undefined, accountPin: found.user.pinCredentialRef !== undefined };
    },
    verify: async (userId, pin) => (await check(userId, pin)).result,
    create: async (userId, pin) => {
      const found = await effectiveIn(db, userId);
      if (found.ref) throw new Error(found.scope === 'account' ? 'This profile already has a PIN.' : 'This device already has a PIN for this profile.');
      await write(userId, pin, found);
    },
    change: async (userId, current, next) => {
      assertWellFormed(next);
      const { result, against } = await check(userId, current);
      if (result.ok && against) await write(userId, next, against);
      return result;
    },
    remove: async (userId, current) => {
      const { result, against } = await check(userId, current);
      if (result.ok && against) await clear(userId, against);
      return result;
    },
    setScope: async (userId, scope, current) => {
      let checked = await effectiveIn(db, userId);
      if (checked.scope === scope) return { ok: true };
      if (checked.ref) {
        if (current === undefined) throw new Error('Where a PIN applies changes only with the PIN asked for now.');
        const { result, against } = await check(userId, current);
        if (!result.ok || !against) return result;
        checked = against;
      }
      const before = checked;
      await db.transaction(async (tx) => {
        const now = await effectiveIn(tx, userId);
        assertUnchanged(now, before);
        if (scope === 'device') {
          // Never the account's ref: it stays the account's.
          await tx.deviceSettings.update((settings) => withDevicePin(settings, userId, {}));
        } else {
          await tx.deviceSettings.update((settings) => withoutDevicePin(settings, userId));
          if (now.ref) await tx.staleSecrets.add([now.ref]);
        }
      });
      await janitor.drain();
      return { ok: true };
    },
    forgot: async (userId, proof) => {
      const found = await effectiveIn(db, userId);
      const reason = found.scope === 'device' ? 'Confirm it’s you to reset this profile’s PIN on this device' : 'Confirm it’s you to reset this profile’s PIN';
      const verdict = await owner.verify(reason, proof);
      if (verdict !== 'verified') return verdict;
      await clear(userId);
      throttles.delete(userId);
      return verdict;
    },
  };
}
