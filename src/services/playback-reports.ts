import type { MediaItem, PlayerEvent, ProgressReport, UserId } from '@sc/api';

import type { Clock } from './ports';
import type { WatchService } from './watch';

// Often enough that a phone that dies loses little; rarely enough that the outbox stays short.
const PROGRESS_EVERY_MS = 10_000;

export interface PlaybackReports {
  /** Every event the player sends. */
  event(event: PlayerEvent): void;
  /** The player is closing: where it got to is where it stopped. */
  stop(): Promise<void>;
}

/**
 * Turns a player's events into watch reports: a start when it first plays,
 * progress every ten seconds while playing and on each pause, and a stop —
 * at the end, or wherever the player was closed. Live streams report
 * nothing. The watch service tells only a source that keeps watch state.
 */
export function playbackReports(deps: {
  readonly watch: Pick<WatchService, 'report'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly userId: UserId;
  readonly item: MediaItem;
  readonly live: boolean;
}): PlaybackReports {
  const { watch, userId, item } = deps;
  const key = item.key;
  let started = false;
  let stopped = false;
  let positionMs = 0;
  let durationMs: number | undefined;
  let lastProgressAt = 0;
  let queue = Promise.resolve();

  // One at a time, in order: a start must be written before the progress after it. The
  // report is made when it happens; only writing it waits its turn.
  const send = (report: ProgressReport) => {
    queue = queue.then(() => watch.report(userId, item, report)).catch(() => undefined);
    return queue;
  };

  const stopAt = (at: number) => {
    if (!started || stopped || deps.live) return queue;
    stopped = true;
    return send({ kind: 'stopped', key, positionMs: at });
  };

  return {
    event: (event) => {
      if (deps.live || stopped) return;
      if (event.type === 'position') {
        positionMs = event.positionMs;
        durationMs = event.durationMs ?? durationMs;
        if (started && deps.clock.now() - lastProgressAt >= PROGRESS_EVERY_MS) {
          lastProgressAt = deps.clock.now();
          void send({ kind: 'progress', key, positionMs, paused: false });
        }
        return;
      }
      if (event.type !== 'state') return;
      if (event.state === 'playing' && !started) {
        started = true;
        lastProgressAt = deps.clock.now();
        void send({ kind: 'started', key, positionMs });
      } else if (event.state === 'paused' && started) {
        lastProgressAt = deps.clock.now();
        void send({ kind: 'progress', key, positionMs, paused: true });
      } else if (event.state === 'ended') {
        void stopAt(durationMs ?? positionMs);
      }
    },
    stop: () => stopAt(positionMs),
  };
}
