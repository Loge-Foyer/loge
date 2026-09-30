import { AppError, type ConnectedMediaProvider, type PlaybackReport, type UserId } from '@sc/api';

import { isAborted, toAppError } from '../media/errors';
import type { ProviderPool } from '../media/pool';
import type { AppActivity, Clock, Logger, NetworkMonitor, OutboxEntry, OutboxRepository } from '../ports';
import type { Source, SourceService } from '../sources';

const AFTER_QUEUE_MS = 1_000;
const FIRST_RETRY_MS = 30_000;
const LAST_RETRY_MS = 30 * 60_000;

export interface OutboxDrainer {
  start(): void;
  stop(): void;
  /** Something was queued, or a source may answer again: deliver soon. */
  kick(): void;
  /** Delivers what can be delivered now, and resolves when that is done. */
  drain(): Promise<void>;
}

/**
 * Carries the outbox to the sources, oldest first — one lane per profile and
 * connection, so an item's reports arrive in order, and one source that cannot
 * answer holds up nobody else. It follows the retry hints: `backoff` tries
 * again later, doubling; `network-change` parks the source until the network
 * changes; a refused sign-in parks it until the user acts — never a loop
 * against a server that locks accounts. A report the source refuses for good,
 * or about an item it no longer has, is dropped.
 */
export function createOutboxDrainer(deps: {
  readonly outbox: OutboxRepository;
  readonly sources: SourceService;
  readonly pool: ProviderPool;
  readonly network: NetworkMonitor;
  readonly activity: AppActivity;
  readonly clock: Clock;
  readonly log: Logger;
  readonly afterQueueMs?: number;
}): OutboxDrainer {
  const { outbox, pool, clock, log } = deps;
  let running: Promise<void> | undefined;
  let again = false;
  let soon: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void)[] = [];

  const deliver = (provider: ConnectedMediaProvider, report: PlaybackReport) => {
    if (report.kind === 'played') {
      if (!provider.setPlayed) throw missing('setPlayed');
      return provider.setPlayed(report.key, report.played);
    }
    if (!provider.reportPlayback) throw missing('reportPlayback');
    return provider.reportPlayback(report);
  };

  // Read afresh before each delivery: a report the outbox has since replaced is never sent.
  const pass = async () => {
    const blocked = new Set<string>();
    const sourcesOf = new Map<UserId, Promise<readonly Source[]>>();
    let nextRetry: number | undefined;
    const laneOf = (entry: OutboxEntry) => `${entry.userId}|${entry.report.key.connectionId}`;

    for (;;) {
      const now = clock.now();
      let entry: OutboxEntry | undefined;
      for (const candidate of await outbox.list()) {
        if (blocked.has(laneOf(candidate))) continue;
        if (candidate.notBefore !== undefined && candidate.notBefore > now) {
          blocked.add(laneOf(candidate));
          nextRetry = Math.min(nextRetry ?? candidate.notBefore, candidate.notBefore);
          continue;
        }
        entry = candidate;
        break;
      }
      if (!entry) break;
      const lane = laneOf(entry);
      if (!sourcesOf.has(entry.userId)) sourcesOf.set(entry.userId, deps.sources.forUser(entry.userId));
      const connectionId = entry.report.key.connectionId;
      const source = (await sourcesOf.get(entry.userId))?.find((candidate) => candidate.connection.id === connectionId);
      // Switched off, or waiting for this profile's values: the reports wait with it.
      if (!source || pool.parked(source)) {
        blocked.add(lane);
        continue;
      }
      if (!(source.effective.media?.capabilities.has('watchStateWrite') ?? false)) {
        // Switched off for good by a setting: nothing will ever take these.
        await outbox.remove(entry.seq);
        continue;
      }
      try {
        await deliver(await pool.provider(source), entry.report);
        await outbox.remove(entry.seq);
      } catch (error) {
        if (isAborted(error)) {
          blocked.add(lane);
          continue;
        }
        const retryAt = await failed(entry, source, toAppError(error, log), now);
        if (retryAt === 'dropped') continue;
        blocked.add(lane);
        if (retryAt !== undefined) nextRetry = Math.min(nextRetry ?? retryAt, retryAt);
      }
    }

    clearTimeout(retry);
    if (nextRetry !== undefined) retry = setTimeout(later, Math.max(0, nextRetry - clock.now()));
  };

  /** What a failure means for its entry: dropped, retried at a time, or waiting on the network or the user. */
  const failed = async (entry: OutboxEntry, source: Source, failure: AppError, now: number): Promise<number | 'dropped' | undefined> => {
    if (failure.code === 'NOT_FOUND' || (failure.retry === 'never' && failure.code !== 'UNAUTHORIZED')) {
      log.warn('provider', 'A watch report was refused for good, and dropped', { code: failure.code, kind: entry.report.kind });
      await outbox.remove(entry.seq);
      return 'dropped';
    }
    if (failure.code === 'UNAUTHORIZED' || failure.retry === 'network-change') {
      pool.park(source, failure);
      return undefined;
    }
    const attempts = entry.attempts + 1;
    const at = now + Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), LAST_RETRY_MS);
    await outbox.defer(entry.seq, attempts, at);
    return at;
  };

  const drain = async (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } catch (error) {
        log.error('provider', 'The watch outbox could not be delivered', { error: String(error) });
      } finally {
        running = undefined;
      }
    })();
    return running;
  };

  const later = () => void drain();

  return {
    start: () => {
      if (unsubscribe.length > 0) return;
      unsubscribe = [
        deps.network.subscribe((kind) => {
          if (kind !== 'none') void drain();
        }),
        deps.activity.subscribe((active) => {
          if (active) void drain();
        }),
      ];
      void drain();
    },
    stop: () => {
      for (const stop of unsubscribe) stop();
      unsubscribe = [];
      clearTimeout(soon);
      clearTimeout(retry);
    },
    kick: () => {
      clearTimeout(soon);
      soon = setTimeout(later, deps.afterQueueMs ?? AFTER_QUEUE_MS);
    },
    drain,
  };
}

// A plugin bug, which trying again cannot mend.
function missing(member: string): AppError {
  return new AppError('INVALID_STATE', `This source claims watchStateWrite without ${member}.`, { retry: 'never' });
}
