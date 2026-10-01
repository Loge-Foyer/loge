import type { UserId } from '@sc/api';

import { decideInitialGate, type Gate } from './boot';
import type { AppSettingsService } from './app-settings';
import type { PinCheck, PinService } from './pins';
import type { AccountRepository, DeviceSettingsRepository, UserRepository } from './ports';
import { toAppUser } from './users';

export interface SessionService {
  getSnapshot(): Gate;
  subscribe(listener: () => void): () => void;
  /** Runs the boot decision once storage is reachable. */
  start(): Promise<void>;
  /**
   * Make a profile active. A profile with a PIN is not entered here: while the
   * app is running the caller shows an unlock screen; before that, the gate
   * moves to `needs-user-unlock`.
   */
  select(userId: UserId): Promise<'ready' | 'locked'>;
  unlock(userId: UserId, pin: string): Promise<PinCheck>;
  /** Back to the profile picker from the boot-time unlock screen. */
  chooseAnother(): void;
  /** A profile was deleted; leave it if it was the active one. */
  forget(userId: UserId): void;
  /**
   * Profiles changed underneath — the account brought some, or took some
   * away. Before a profile is chosen, decide again; with one chosen, leave it
   * only if it is gone. A PIN set meanwhile never locks the profile in use.
   */
  refresh(): Promise<void>;
}

export function createSessionService(deps: {
  users: UserRepository;
  deviceSettings: DeviceSettingsRepository;
  account: AccountRepository;
  pins: PinService;
  appSettings: Pick<AppSettingsService, 'get'>;
}): SessionService {
  const { users, deviceSettings, account, pins, appSettings } = deps;
  let gate: Gate = { kind: 'starting' };
  const listeners = new Set<() => void>();
  const move = (next: Gate) => {
    gate = next;
    for (const listener of listeners) listener();
  };
  const same = (a: Gate, b: Gate) => a.kind === b.kind && ('userId' in a ? a.userId : undefined) === ('userId' in b ? b.userId : undefined);

  // The first profile chosen on a device without a default becomes it, as the first one created does.
  const enter = async (userId: UserId) => {
    move({ kind: 'ready', userId });
    await deviceSettings.update((current) => (current.defaultUserId === undefined ? { ...current, defaultUserId: userId } : current));
  };

  return {
    getSnapshot: () => gate,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: async () => {
      try {
        const [stored, settings, held, app] = await Promise.all([users.list(), deviceSettings.get(), account.get(), appSettings.get()]);
        const decision = decideInitialGate({
          hasAccount: held !== undefined,
          users: stored.map(toAppUser),
          defaultUserId: settings.defaultUserId,
          alwaysChooseProfile: app.alwaysChooseProfile,
        });
        if (decision.clearDefaultUser) {
          await deviceSettings.update(({ defaultUserId: _gone, ...rest }) => rest);
        }
        move(decision.gate);
      } catch (error) {
        move({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    },
    select: async (userId) => {
      const user = await users.get(userId);
      if (!user) throw new Error(`Unknown profile ${userId}`);
      if (user.pinCredentialRef === undefined) {
        await enter(userId);
        return 'ready';
      }
      if (gate.kind !== 'ready') move({ kind: 'needs-user-unlock', userId });
      return 'locked';
    },
    unlock: async (userId, pin) => {
      const check = await pins.verify(userId, pin);
      if (check.ok) await enter(userId);
      return check;
    },
    chooseAnother: () => move({ kind: 'needs-user-selection' }),
    forget: (userId) => {
      if ((gate.kind === 'ready' || gate.kind === 'needs-user-unlock') && gate.userId === userId) {
        move({ kind: 'needs-user-selection' });
      }
    },
    refresh: async () => {
      if (gate.kind === 'starting' || gate.kind === 'failed') return;
      const [stored, settings, held, app] = await Promise.all([users.list(), deviceSettings.get(), account.get(), appSettings.get()]);
      const current = gate;
      let next: Gate = current;
      if (held === undefined) next = { kind: 'needs-account' };
      else if (stored.length === 0) next = { kind: 'needs-first-user' };
      else if (current.kind === 'needs-account' || current.kind === 'needs-first-user' || current.kind === 'needs-user-selection') {
        // Decided as at launch, so a sync while the picker is up never walks past it into the default profile.
        next = decideInitialGate({
          hasAccount: true,
          users: stored.map(toAppUser),
          defaultUserId: settings.defaultUserId,
          alwaysChooseProfile: app.alwaysChooseProfile,
        }).gate;
      } else if ((current.kind === 'ready' || current.kind === 'needs-user-unlock') && !stored.some((user) => user.id === current.userId)) {
        next = { kind: 'needs-user-selection' };
      }
      if (!same(next, current)) move(next);
    },
  };
}
