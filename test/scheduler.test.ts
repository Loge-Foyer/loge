import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangeJournal } from '@/services/ports';
import type { SyncEngine, SyncStatus } from '@/services/sync/engine';
import { createSyncScheduler, type SyncScheduler } from '@/services/sync/scheduler';

import { fakeNetwork } from './support/fakes';
import { fakeActivity } from './support/sync';

const SYNCED: SyncStatus = { phase: 'synced', pending: 0 };
const RETRY_LATER: SyncStatus = { phase: 'waiting', pending: 1, problem: { code: 'PROVIDER_UNAVAILABLE', message: 'Down.', retry: 'backoff' } };
const OTHER_NETWORK: SyncStatus = { phase: 'waiting', pending: 1, problem: { code: 'OFFLINE', message: 'Away.', retry: 'network-change' } };
const REFUSED: SyncStatus = { phase: 'needs-sign-in', pending: 1, problem: { code: 'UNAUTHORIZED', message: 'No.', retry: 'never' } };

/** An engine whose runs end in whatever the test lines up. */
function scriptedEngine() {
  let status: SyncStatus = SYNCED;
  const ahead: SyncStatus[] = [];
  const calls = { runs: 0, changed: 0 };
  const engine: SyncEngine = {
    status: () => status,
    subscribe: () => () => undefined,
    onApplied: () => () => undefined,
    report: () => undefined,
    changed: async () => {
      calls.changed += 1;
    },
    run: async () => {
      calls.runs += 1;
      status = ahead.shift() ?? status;
    },
    finalPush: async () => true,
    accountChanged: () => undefined,
  };
  return { engine, calls, then: (...statuses: SyncStatus[]) => ahead.push(...statuses) };
}

function fakeJournal(): ChangeJournal & { commit(): void } {
  const listeners = new Set<() => void>();
  return {
    entries: async () => [],
    head: async () => 0,
    count: async () => 0,
    announce: async () => undefined,
    prune: async () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    commit: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe('the sync scheduler', () => {
  let scheduler: SyncScheduler | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    scheduler?.stop();
    vi.useRealTimers();
  });

  function setUp() {
    const scripted = scriptedEngine();
    const journal = fakeJournal();
    const network = fakeNetwork();
    const activity = fakeActivity();
    scheduler = createSyncScheduler({ engine: scripted.engine, journal, network, activity });
    return { ...scripted, journal, network, activity, scheduler };
  }

  it('runs at launch, and once a moment after a burst of journaled commits', async () => {
    const { calls, journal, scheduler } = setUp();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.runs).toBe(1);
    journal.commit();
    journal.commit();
    journal.commit();
    // The count of changes waiting follows every commit; the run waits for the burst to end.
    expect(calls.changed).toBe(3);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(calls.runs).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.runs).toBe(2);
  });

  it('tries again later after a failure it may retry, waiting twice as long each time', async () => {
    const { calls, then, scheduler } = setUp();
    then(RETRY_LATER, RETRY_LATER, RETRY_LATER);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.runs).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.runs).toBe(2);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(calls.runs).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.runs).toBe(3);
  });

  it('lets neither a poll nor a change cut a backoff short — a network change does', async () => {
    const { calls, then, journal, network, scheduler } = setUp();
    then(RETRY_LATER, SYNCED);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    journal.commit();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls.runs).toBe(1);
    network.set('ethernet');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.runs).toBe(2);
  });

  it('waits for another network when told to, and runs as soon as it changes', async () => {
    const { calls, then, journal, network, scheduler } = setUp();
    then(OTHER_NETWORK);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    journal.commit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.runs).toBe(1);
    network.set('cellular');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.runs).toBe(2);
  });

  it('never runs an account that refused again by itself — only a new sign-in does', async () => {
    const { calls, then, journal, network, activity, scheduler } = setUp();
    then(REFUSED);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    journal.commit();
    network.set('cellular');
    activity.set(false);
    activity.set(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await scheduler.now();
    expect(calls.runs).toBe(1);
    await scheduler.accountChanged();
    expect(calls.runs).toBe(2);
  });

  it('asks every minute in the foreground, and not at all in the background', async () => {
    const { calls, activity, scheduler } = setUp();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.runs).toBe(2);
    activity.set(false);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(calls.runs).toBe(2);
    activity.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.runs).toBe(3);
  });

  it('runs "Sync now" at once, whatever a retry was waiting for', async () => {
    const { calls, then, scheduler } = setUp();
    then(RETRY_LATER, SYNCED);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.now();
    expect(calls.runs).toBe(2);
    // The retry it was waiting for is gone: only the minute's poll runs, not a retry at 30 s as well.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.runs).toBe(3);
  });
});
