import type { AppActivity, ChangeJournal, NetworkMonitor } from '../ports';
import type { SyncEngine } from './engine';

const AFTER_CHANGE_MS = 2_000;
const POLL_MS = 60_000;
const FIRST_RETRY_MS = 30_000;
const LAST_RETRY_MS = 15 * 60_000;

type Reason = 'launch' | 'change' | 'network' | 'foreground' | 'poll' | 'retry' | 'account';

export interface SyncScheduler {
  start(): void;
  /** "Sync now": runs whatever the network or a retry was waiting for — never for an account that refused. */
  now(): Promise<void>;
  /** The account changed: start again from a clean slate. */
  accountChanged(): Promise<void>;
  stop(): void;
}

/**
 * When the engine runs: at launch, on coming to the foreground, a moment after
 * a journaled commit, when the network changes, every minute in the
 * foreground, and on "Sync now" — never inside a write. It follows the retry
 * hints: `backoff` tries again later, doubling; `network-change` waits for
 * another network; an account that refused waits for the user, always.
 */
export function createSyncScheduler(deps: {
  readonly engine: SyncEngine;
  readonly journal: ChangeJournal;
  readonly network: NetworkMonitor;
  readonly activity: AppActivity;
}): SyncScheduler {
  const { engine } = deps;
  let unsubscribe: (() => void)[] = [];
  let afterChange: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let retries = 0;
  let started = false;

  /**
   * Whether a trigger may run the engine. A refused sign-in, a failure and an
   * account this build cannot run wait for the user — or a new account; a
   * network change never retries them. Waiting for another network ends with
   * a network change. Backing off, only the retry itself or a new network runs
   * it: a poll every minute would ask a failing account every minute.
   */
  const allowed = (reason: Reason) => {
    if (reason === 'account') return true;
    const { phase, problem } = engine.status();
    if (phase === 'needs-sign-in' || phase === 'failed' || phase === 'unavailable') return false;
    if (phase === 'waiting' && problem?.retry === 'network-change') return reason === 'network';
    if (phase === 'waiting' && problem?.retry === 'backoff') return reason === 'retry' || reason === 'network';
    return true;
  };

  const afterRun = () => {
    const { phase, problem } = engine.status();
    if (phase === 'waiting' && problem?.retry === 'backoff') {
      clearTimeout(retry);
      const wait = Math.min(FIRST_RETRY_MS * 2 ** retries, LAST_RETRY_MS);
      retries += 1;
      retry = setTimeout(() => void request('retry'), wait);
    } else if (phase === 'synced') {
      retries = 0;
    }
  };

  const request = async (reason: Reason) => {
    if (!allowed(reason)) return;
    await engine.run();
    afterRun();
  };

  const startPolling = () => {
    clearInterval(poll);
    poll = setInterval(() => void request('poll'), POLL_MS);
  };

  return {
    start: () => {
      if (started) return;
      started = true;
      unsubscribe = [
        deps.journal.subscribe(() => {
          clearTimeout(afterChange);
          afterChange = setTimeout(() => void request('change'), AFTER_CHANGE_MS);
        }),
        deps.network.subscribe((kind) => {
          if (kind === 'none') return;
          retries = 0;
          void request('network');
        }),
        deps.activity.subscribe((active) => {
          if (!active) {
            clearInterval(poll);
            return;
          }
          startPolling();
          void request('foreground');
        }),
      ];
      if (deps.activity.active()) startPolling();
      void request('launch');
    },
    now: async () => {
      if (engine.status().phase === 'needs-sign-in') return;
      retries = 0;
      clearTimeout(retry);
      await engine.run();
      afterRun();
    },
    accountChanged: async () => {
      retries = 0;
      clearTimeout(retry);
      engine.accountChanged();
      await request('account');
    },
    stop: () => {
      started = false;
      for (const stop of unsubscribe) stop();
      unsubscribe = [];
      clearTimeout(afterChange);
      clearTimeout(retry);
      clearInterval(poll);
    },
  };
}
