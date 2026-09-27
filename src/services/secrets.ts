import type { LocalDatabase, Logger, SecureCredentialStore } from './ports';

/**
 * Deletes the secrets that nothing points at any more. The keychain cannot
 * list what it holds, so a ref is queued in the very transaction that stops
 * pointing at it, and deleted from the credential stores here: right after
 * that commit, and again at launch for whatever a crash left in the queue.
 */
export interface SecretJanitor {
  /** Never throws: a secret that cannot go yet stays queued for the next time. */
  drain(): Promise<void>;
}

export function createSecretJanitor(deps: {
  readonly db: LocalDatabase;
  /** Every store a ref may live in; deleting from one that does not have it is harmless. */
  readonly stores: readonly SecureCredentialStore[];
  readonly log: Logger;
}): SecretJanitor {
  let tail: Promise<void> = Promise.resolve();

  const drainOnce = async () => {
    for (const ref of await deps.db.staleSecrets.list()) {
      for (const store of deps.stores) await store.delete(ref);
      await deps.db.staleSecrets.remove([ref]);
    }
  };

  return {
    // One at a time: a drain asked for meanwhile runs after, and picks up what was queued since.
    drain: () => {
      tail = tail.then(drainOnce).catch((error: unknown) => {
        deps.log.warn('storage', 'Some old secrets could not be deleted yet', { error: String(error) });
      });
      return tail;
    },
  };
}
