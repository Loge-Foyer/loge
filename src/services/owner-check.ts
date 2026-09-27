import { isAppError, type CancelSignal } from '@sc/api';

import type { Logger, OwnerAnswer, OwnerAuthentication } from './ports';

/** How the owner would be asked: through the account, or by the device. */
export type OwnerMethod = 'account' | 'device';

/** `failed`: the account could not be asked at all — offline, say. */
export type OwnerVerdict = OwnerAnswer | 'failed';

/**
 * Re-verifies whoever owns this device's profiles: the account's own check
 * when it has one, else Face ID or the passcode. What a forgotten PIN, and
 * every change to the account, go through.
 */
export interface OwnerCheck {
  /** How the owner would be asked right now; `null` when they cannot be. */
  method(): Promise<OwnerMethod | null>;
  verify(reason: string): Promise<OwnerVerdict>;
}

export function createOwnerCheck(deps: {
  /** The account's owner check, when there is an account and it has one. */
  readonly account: () => Promise<((signal?: CancelSignal) => Promise<void>) | undefined>;
  readonly device: OwnerAuthentication;
  readonly log: Logger;
}): OwnerCheck {
  const viaAccount = () => deps.account().catch(() => undefined);
  const deviceCan = () => deps.device.available().catch(() => false);

  return {
    method: async () => ((await viaAccount()) ? 'account' : (await deviceCan()) ? 'device' : null),
    verify: async (reason) => {
      const account = await viaAccount();
      if (account) {
        try {
          await account();
          return 'verified';
        } catch (error) {
          if (isAppError(error) && error.code === 'UNAUTHORIZED') return 'refused';
          deps.log.warn('sync', 'The account could not check its owner', { error: String(error) });
          return 'failed';
        }
      }
      if (await deviceCan()) return deps.device.authenticate(reason);
      return 'unavailable';
    },
  };
}
