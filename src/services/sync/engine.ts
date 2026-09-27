import { AppError, isAppError, type AppErrorCode, type RetryHint } from '@sc/api';

import { MissingSecretError } from '../plugin-context';
import type { Clock, RunLock } from '../ports';
import { applyPage, type Applied, type SyncParts } from './apply';
import { currentAccount, type CurrentAccount } from './current';
import { joinAccount, previewAccount, type JoinReason } from './join';
import type { AccountProviders } from './provider';
import { pushPending } from './push';

export type SyncPhase =
  | 'idle' // there is no account
  | 'syncing'
  | 'synced'
  | 'waiting' // for a better network, or for a retry
  | 'needs-sign-in' // the account refused, or its password is not on this device: never tried again by itself
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
  /** Told of every batch of changes from the account, once committed. */
  onApplied(listener: (applied: Applied) => void): () => void;
  /** Changes from the account applied elsewhere — a sign-in's join — for the same listeners to hear of. */
  report(applied: Applied): void;
  /** A run now, or right after the one in progress. Never throws: what went wrong is in the status. */
  run(): Promise<void>;
  /** One last push to the account, tried once, before this device leaves it. `true` when everything went. */
  finalPush(timeoutMs: number): Promise<boolean>;
  /** The account changed or went: let its provider go. */
  accountChanged(): void;
}

const LOCK = 'streaming-center-sync';
const MAX_JOINS_PER_RUN = 2;

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
  const pendingOf = async (account: CurrentAccount) => {
    const state = await parts.db.syncState.get(account.connection.id);
    return parts.db.journal.count(state?.checkpoint ?? 0);
  };

  const join = async (account: CurrentAccount, reason: JoinReason) => {
    const provider = await providers.provider(account.connection);
    const preview = await previewAccount(provider, account.carried, parts);
    applied(await joinAccount(parts, account.connection, account.carried, preview, reason));
  };

  const runOnce = async () => {
    const account = await currentAccount(parts.db, parts.catalog);
    if (!account) {
      set({ phase: 'idle', pending: 0 });
      return;
    }
    if (!account.available) {
      set({ phase: 'unavailable', pending: await pendingOf(account) });
      return;
    }
    set({ ...status, phase: 'syncing' });
    try {
      const provider = await providers.provider(account.connection);
      let joins = 0;
      const rejoin = async (reason: JoinReason) => {
        joins += 1;
        if (joins > MAX_JOINS_PER_RUN) throw new AppError('PROVIDER_UNAVAILABLE', 'The account keeps losing its place.', { retry: 'backoff' });
        await join(account, reason);
      };

      const stored = await parts.db.syncState.get(account.connection.id);
      if (!stored) await rejoin({ kind: 'reset' });
      else if ([...account.carried].some((capability) => !stored.carried.includes(capability))) await rejoin({ kind: 'grow' });
      else if (stored.carried.some((capability) => !account.carried.has(capability))) {
        // Carrying less: remembered, so carrying it again joins again and sends what changed meanwhile.
        await parts.db.unjournaled(async (tx) => {
          const state = await tx.syncState.get(account.connection.id);
          if (state) await tx.syncState.put({ ...state, carried: [...account.carried] });
        });
      }

      for (;;) {
        const state = await parts.db.syncState.get(account.connection.id);
        if (!state) break;
        const page = await provider.pull(state.cursor);
        if (page.kind === 'reset') {
          await rejoin({ kind: 'reset' });
          continue;
        }
        if (page.kind === 'expired') {
          // Nothing was lost, only the place in the log: read it all again, and send nothing extra.
          const preview = await previewAccount(provider, account.carried, parts);
          const result = await applyPage(parts, account.connection, account.carried, state.cursor, preview.changes, preview.cursor);
          if (result !== 'moved') applied(result);
          continue;
        }
        const result = await applyPage(parts, account.connection, account.carried, state.cursor, page.changes, page.cursor);
        if (result === 'moved') continue;
        applied(result);
        if (!page.more) break;
      }

      const outcome = await pushPending(parts, provider, account.connection, account.carried);
      const lastSyncedAt = clock.now();
      await parts.db.unjournaled(async (tx) => {
        const state = await tx.syncState.get(account.connection.id);
        if (state) await tx.syncState.put({ ...state, lastSyncedAt });
      });
      set(
        outcome === 'done'
          ? { phase: 'synced', lastSyncedAt, pending: await pendingOf(account) }
          : {
              phase: 'waiting',
              lastSyncedAt,
              pending: await pendingOf(account),
              problem: { code: 'PROVIDER_UNAVAILABLE', message: 'The account took only some of the changes.', retry: 'backoff' },
            },
      );
    } catch (error) {
      const problem = problemOf(error);
      parts.log.warn('sync', 'A sync run did not finish', { code: problem.code, retry: problem.retry });
      const state = await parts.db.syncState.get(account.connection.id).catch(() => undefined);
      set({
        phase: problem.code === 'UNAUTHORIZED' ? 'needs-sign-in' : problem.retry === 'never' ? 'failed' : 'waiting',
        ...(state?.lastSyncedAt === undefined ? {} : { lastSyncedAt: state.lastSyncedAt }),
        pending: await pendingOf(account).catch(() => status.pending),
        problem,
      });
    }
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
        await lock.run(LOCK, runOnce).catch((error: unknown) => {
          parts.log.error('sync', 'A sync run broke', { error: String(error) });
        });
      });
      return tail;
    },
    finalPush: async (timeoutMs) => {
      const account = await currentAccount(parts.db, parts.catalog);
      if (!account?.available) return false;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await lock.run(LOCK, async () => {
          const provider = await providers.provider(account.connection);
          return (await pushPending(parts, provider, account.connection, account.carried, controller.signal)) === 'done';
        });
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    accountChanged: () => {
      providers.forget();
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
