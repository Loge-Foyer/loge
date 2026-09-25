import type { UserId } from '@sc/api';

import { decideInitialGate, type Gate } from './boot';
import type { PinCheck, PinService } from './pins';
import type { DeviceSettingsRepository, UserRepository } from './ports';
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
}

export function createSessionService(deps: {
  users: UserRepository;
  deviceSettings: DeviceSettingsRepository;
  pins: PinService;
}): SessionService {
  const { users, deviceSettings, pins } = deps;
  let gate: Gate = { kind: 'starting' };
  const listeners = new Set<() => void>();
  const move = (next: Gate) => {
    gate = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => gate,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: async () => {
      try {
        const [stored, settings] = await Promise.all([users.list(), deviceSettings.get()]);
        const decision = decideInitialGate({
          users: stored.map(toAppUser),
          defaultUserId: settings.defaultUserId,
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
        move({ kind: 'ready', userId });
        return 'ready';
      }
      if (gate.kind !== 'ready') move({ kind: 'needs-user-unlock', userId });
      return 'locked';
    },
    unlock: async (userId, pin) => {
      const check = await pins.verify(userId, pin);
      if (check.ok) move({ kind: 'ready', userId });
      return check;
    },
    chooseAnother: () => move({ kind: 'needs-user-selection' }),
    forget: (userId) => {
      if ((gate.kind === 'ready' || gate.kind === 'needs-user-unlock') && gate.userId === userId) {
        move({ kind: 'needs-user-selection' });
      }
    },
  };
}
