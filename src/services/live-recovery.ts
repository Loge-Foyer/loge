import { isAppError, type PlayerState } from '@loge/api';

/**
 * A live channel whose stream stops comes back by itself: a new link and a
 * new engine, a moment later. Three tries in a row at most, further apart
 * each time; a minute of playing and the count starts again. Never after a
 * refusal — a portal locks a line that keeps signing in — nor on a failure the
 * source says not to repeat, nor one that waits for another network.
 */
export const RECOVERY_DELAYS_MS: readonly number[] = [1_000, 4_000, 10_000];
/** Playing this long, and the tries are counted afresh. */
export const STEADY_MS = 60_000;
/** Buffering this long is a stream that stopped: mpv can wait there for ever. */
export const STALL_MS = 15_000;

/** Whether a stop is one to come back from: an end, a stall, or a failure the source says to try again later. */
export function recoverable(state: PlayerState | 'stalled', error: unknown): boolean {
  if (state === 'ended' || state === 'stalled') return true;
  if (state !== 'failed') return false;
  return isAppError(error) && error.retry === 'backoff' && error.code !== 'UNAUTHORIZED';
}

/** How long to wait before the try after `tries` of them, or nothing once they are spent. */
export function nextTryIn(tries: number): number | undefined {
  return RECOVERY_DELAYS_MS[tries];
}
