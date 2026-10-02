import { isAppError, type CancelSignal, type Credentials, type PasswordField, type PluginManifest } from '@loge/api';

import type { PluginCatalog } from './plugin-catalog';
import type { LocalDatabase, Logger, OwnerAnswer, OwnerAuthentication } from './ports';
import { currentAccount } from './sync/current';
import type { SyncStatus } from './sync/engine';
import type { AccountProviders } from './sync/provider';

/**
 * How the owner would be asked: through the account — typing again the
 * password fields its proof asks for, if any — or by the device.
 */
export type OwnerMethod = { readonly via: 'account'; readonly asks: readonly PasswordField[] } | { readonly via: 'device' };

/**
 * `failed`: the account could not be asked at all — offline, say.
 * `throttled`: too many wrong tries, so nothing was judged; wait, then try again.
 */
export type OwnerVerdict = OwnerAnswer | 'failed' | 'throttled';

/** The account's own owner check, and what it asks for. */
export interface AccountOwnerCheck {
  readonly asks: readonly PasswordField[];
  verify(proof: Credentials, signal?: CancelSignal): Promise<void>;
}

/**
 * Re-verifies whoever owns this device's profiles: the account's own check
 * when it has one, else Face ID or the passcode. What a forgotten PIN, and
 * every change to the account, go through.
 */
export interface OwnerCheck {
  /** How the owner would be asked right now; `null` when they cannot be. */
  method(): Promise<OwnerMethod | null>;
  /** `proof` is what the method asks for, typed again — never a password saved on the device. */
  verify(reason: string, proof?: Credentials): Promise<OwnerVerdict>;
}

export function createOwnerCheck(deps: {
  /** The account's owner check, when there is an account and it has one. */
  readonly account: () => Promise<AccountOwnerCheck | undefined>;
  readonly device: OwnerAuthentication;
  readonly log: Logger;
}): OwnerCheck {
  const viaAccount = () => deps.account().catch(() => undefined);
  const deviceCan = () => deps.device.available().catch(() => false);
  const viaDevice = async (reason: string): Promise<OwnerVerdict> => ((await deviceCan()) ? deps.device.authenticate(reason) : 'unavailable');

  return {
    method: async () => {
      const account = await viaAccount();
      if (account) return { via: 'account', asks: account.asks };
      return (await deviceCan()) ? { via: 'device' } : null;
    },
    verify: async (reason, proof = {}) => {
      const account = await viaAccount();
      if (!account) return viaDevice(reason);
      // Nothing typed is no proof: refused here, so it never counts as a wrong try there.
      if (account.asks.some((field) => (proof[field.key] ?? '') === '')) return 'refused';
      try {
        await account.verify(proof);
        return 'verified';
      } catch (error) {
        if (!isAppError(error) || error.code !== 'UNAUTHORIZED') {
          // A network failure is not a yes, and not a reason to ask someone else instead.
          deps.log.warn('sync', 'The account could not check its owner', { code: isAppError(error) ? error.code : 'unknown' });
          return 'failed';
        }
        if (error.reason === 'too-many-attempts') return 'throttled';
        // The account let this device go: it cannot vouch for anyone here, so the device answers.
        if (error.reason === 'signed-out') return viaDevice(reason);
        return 'refused';
      }
    },
  };
}

/** The password fields an account's owner proof asks for, as its manifest declares them. */
export function proofFieldsOf(manifest: PluginManifest | undefined): readonly PasswordField[] {
  const keys = manifest?.account?.ownerProof?.fields ?? [];
  return (manifest?.connectionFields ?? []).filter((field): field is PasswordField => field.type === 'password' && keys.includes(field.key));
}

/**
 * The device's account's own owner check, as it stands. None when there is no
 * account, it has no check, or it no longer lets this device in — let go, or
 * refusing its saved password: it cannot vouch for anyone here then, and the
 * device answers instead.
 */
export function accountOwnerCheck(deps: {
  readonly db: LocalDatabase;
  readonly catalog: PluginCatalog;
  readonly providers: AccountProviders;
  readonly status: () => SyncStatus;
}): () => Promise<AccountOwnerCheck | undefined> {
  return async () => {
    const account = await currentAccount(deps.db, deps.catalog);
    if (account?.kind !== 'server' || !account.available || deps.status().phase === 'needs-sign-in') return undefined;
    const provider = await deps.providers.provider(account.connection);
    const verify = provider.verifyOwner?.bind(provider);
    return verify && { asks: proofFieldsOf(account.manifest), verify };
  };
}
