import { AppError, type PlayerEvent, type PlayerState } from '@sc/api';

/**
 * A controller's listeners and the state they last heard. A state is told
 * once, and a new listener hears the current one at once, so a screen that
 * subscribes after `load` still knows where things are.
 */
export function createEvents() {
  const listeners = new Set<(event: PlayerEvent) => void>();
  let state: PlayerState = 'idle';
  const emit = (event: PlayerEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  const setState = (next: PlayerState) => {
    if (next === state) return;
    state = next;
    emit({ type: 'state', state: next });
  };
  return {
    emit,
    setState,
    state: () => state,
    /** A failure is a state and an error both: a screen that shows either is never left with a silent stop. */
    fail: (error: AppError) => {
      setState('failed');
      emit({ type: 'error', error });
    },
    subscribe: (listener: (event: PlayerEvent) => void) => {
      listeners.add(listener);
      listener({ type: 'state', state });
      return () => {
        listeners.delete(listener);
      };
    },
    clear: () => listeners.clear(),
  };
}

/** A player that was let go refuses everything, loudly. */
export function released(): AppError {
  return new AppError('INVALID_STATE', 'This player was released.');
}

/** An engine's failure. Most are the stream's or the network's, so trying again later can help. */
export function playbackFailed(message: string | undefined, cause?: unknown): AppError {
  return new AppError('PROVIDER_UNAVAILABLE', message && message.trim() !== '' ? message : 'The stream could not be played.', {
    retry: 'backoff',
    ...(cause === undefined ? {} : { cause }),
  });
}
