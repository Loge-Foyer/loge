import type { PlayerState } from '@loge/api';
import { useEffect, useEffectEvent, useState } from 'react';

import { nextTryIn, recoverable, STALL_MS, STEADY_MS } from '@/services/live-recovery';

/**
 * A live channel coming back by itself after its stream stopped
 * (`services/live-recovery.ts`): a new link and a new engine, a moment later,
 * three times in a row at most. Only while its screen is in front, and never
 * for a film, which a stop leaves where it was. Says whether it is on its way
 * back, so the screen shows that rather than a failure.
 */
export function useLiveRecovery(options: { readonly live: boolean; readonly state: PlayerState; readonly error: unknown; readonly focused: boolean; readonly retry: () => void }): boolean {
  const { live, state, error, focused } = options;
  const [tries, setTries] = useState(0);
  const [stalled, setStalled] = useState(false);
  const again = useEffectEvent(options.retry);

  // A minute of playing, and the tries are counted afresh.
  useEffect(() => {
    if (!live || state !== 'playing') return;
    const timer = setTimeout(() => setTries(0), STEADY_MS);
    return () => clearTimeout(timer);
  }, [live, state]);

  // Buffering this long is a stream that stopped: mpv can wait there for ever.
  useEffect(() => {
    if (!live || state !== 'buffering') return;
    const timer = setTimeout(() => setStalled(true), STALL_MS);
    return () => {
      clearTimeout(timer);
      setStalled(false);
    };
  }, [live, state]);

  const delay = live && focused && recoverable(stalled ? 'stalled' : state, error) ? nextTryIn(tries) : undefined;
  useEffect(() => {
    if (delay === undefined) return;
    const timer = setTimeout(() => {
      setTries((count) => count + 1);
      again();
    }, delay);
    return () => clearTimeout(timer);
  }, [delay, tries]);

  return delay !== undefined;
}
