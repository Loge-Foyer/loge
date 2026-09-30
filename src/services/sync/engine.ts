import { AppError, isAppError, type AppErrorCode, type RetryHint } from '@sc/api';

import { MissingSecretError } from '../plugin-context';
import type { Clock, RunLock } from '../ports';
import { currentAccount, type CurrentAccount } from './current';
import type { Applied, SyncParts } from './parts';
import type { AccountProviders } from './provider';
import { pushPending } from './push';
import { reconcile } from './reconcile';

export type SyncPhase =
  | 'idle' // the account is on this device: nothing to sync with
  | 'syncing'
  | 'synced'
  | 'waiting' // for a better network, or for a retry
  | 'needs-sign-in' // the server refused, or its password is not on this device: never tried again by itself
  | 'unavailable' // this build cannot run the account's plugin
  | 'failed';

export interface SyncProblem {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly retry: RetryHint;
  /** The account's saved password is not on this device. */
  readonly needsPassword?: true;
}

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly lastSyncedAt?: number;
  /** Journal entries not sent yet. */
  readonly pending: number;
  readonly problem?: SyncProblem;
}

export interface SyncEngine {
  /** The same object until something changes. */
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
  /** Told of every change from the account, once committed. */
  onApplied(listener: (applied: Applied) => void): () => void;
  /** Changes from the account applied elsewhere — a sign-in's replace — for the same listeners to hear of. */
  report(applied: Applied): void;
  /** A run now, or right after the one in progress. Never throws: what went wrong is in the status. */
  run(): Promise<void>;
  /** A journaled commit: the count of changes waiting, now rather than after the next run. */
  changed(): Promise<void>;
  /** One last push to the account, tried once, before this device leaves it. `true` when everything went. */
  finalPush(timeoutMs: number): Promise<boolean>;
  /** The account changed or went: let its provider go. */
  accountChanged(): void;
}

export const SYNC_LOCK = 'streaming-center-sync';

export function createSyncEngine(deps: {
  readonly parts: SyncParts;
  readonly providers: AccountProviders;
  readonly lock: RunLock;
  readonly clock: Clock;
}): SyncEngine {
  const { parts, providers, lock, clock } = deps;
  let status: SyncStatus = { phase: 'idle', pending: 0 };
  const listeners = new Set<() => void>();
  const appliedListeners = new Set<(applied: Applied) => void>();

  const set = (next: SyncStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };
  const applied = (result: Applied) => {
    if (!result.changed) return;
    for (const listener of appliedListeners) listener(result);
  };
  const pendingOf = async () => parts.db.journal.count((await parts.db.account.sync()).checkpoint);
  // What the server refused as invalid, until the account changes or the app starts again.
  const refused = new Set<string>();

  /**
   * One run: push the journal after the checkpoint, read the whole account,
   * reconcile. There are no cursors and no log: the server's collections are
   * the truth, and an account is small enough to read every time.
   */
  const runOnce = async () => {
    const account = await currentAccount(parts.db, parts.catalog);
    if (account?.kind !== 'server') {
      // Nothing reads the journal of an account on this device: it stays short.
      await parts.db.journal.prune(await parts.db.journal.head());
      set({ phase: 'idle', pending: 0 });
      return;
    }
    if (!account.available) {
      set({ phase: 'unavailable', pending: await pendingOf() });
      return;
    }
    set({ ...status, phase: 'syncing' });
    try {
      const provider = await providers.provider(account.connection);
      await pushPending(parts, provider, refused);
      const snapshot = await provider.pull();
      applied(await reconcile(parts, snapshot.records, { maxProfiles: account.maxProfiles, refused }));
      const lastSyncedAt = clock.now();
      const state = await parts.db.account.sync();
      await parts.db.unjournaled(async (tx) => {
        await tx.account.putSync({ ...(await tx.account.sync()), lastSyncedAt });
        // What reached the account is kept nowhere else: seqs are never reused, so this is safe.
        await tx.journal.prune(state.checkpoint);
      });
      set({ phase: 'synced', lastSyncedAt, pending: await pendingOf() });
    } catch (error) {
      await failed(account, error);
    }
  };

  const failed = async (account: CurrentAccount, error: unknown) => {
    const problem = problemOf(error);
    parts.log.warn('sync', 'A sync run did not finish', { code: problem.code, retry: problem.retry, account: account.kind });
    const state = await parts.db.account.sync().catch(() => undefined);
    set({
      phase: problem.code === 'UNAUTHORIZED' ? 'needs-sign-in' : problem.retry === 'never' ? 'failed' : 'waiting',
      ...(state?.lastSyncedAt === undefined ? {} : { lastSyncedAt: state.lastSyncedAt }),
      pending: await pendingOf().catch(() => status.pending),
      problem,
    });
  };

  // One run at a time, and at most one waiting behind it: requests meanwhile fold into that one.
  let tail: Promise<void> = Promise.resolve();
  let queued = false;

  return {
    status: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onApplied: (listener) => {
      appliedListeners.add(listener);
      return () => {
        appliedListeners.delete(listener);
      };
    },
    report: applied,
    run: () => {
      if (queued) return tail;
      queued = true;
      tail = tail.then(async () => {
        queued = false;
        await lock.run(SYNC_LOCK, runOnce).catch((error: unknown) => {
          parts.log.error('sync', 'A sync run broke', { error: String(error) });
        });
      });
      return tail;
    },
    changed: async () => {
      const seen = status;
      if (seen.phase === 'syncing' || seen.phase === 'idle') return;
      const pending = await pendingOf().catch(() => seen.pending);
      // A run that ended meanwhile counted for itself.
      if (status === seen && pending !== seen.pending) set({ ...seen, pending });
    },
    finalPush: async (timeoutMs) => {
      const account = await currentAccount(parts.db, parts.catalog);
      if (account?.kind !== 'server' || !account.available) return false;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await lock.run(SYNC_LOCK, async () => {
          await pushPending(parts, await providers.provider(account.connection), refused, controller.signal);
          return (await pendingOf()) === 0;
        });
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    accountChanged: () => {
      providers.forget();
      refused.clear();
      set({ phase: 'idle', pending: 0 });
    },
  };
}

function problemOf(error: unknown): SyncProblem {
  const appError = isAppError(error)
    ? error
    : new AppError('PROVIDER_UNAVAILABLE', 'The account ran into a problem.', { retry: 'backoff', cause: error });
  return {
    code: appError.code,
    message: appError.message,
    retry: appError.retry,
    ...(error instanceof MissingSecretError ? { needsPassword: true as const } : {}),
  };
}
