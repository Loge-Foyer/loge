import type { RunLock } from '@/services/ports';

const noop = () => undefined;

/** One holder per name at a time, in the order they asked, within this runtime. */
export function createInProcessLock(): RunLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run: <T>(name: string, work: () => Promise<T>): Promise<T> => {
      const previous = tails.get(name) ?? Promise.resolve();
      const turn = previous.then(work, work);
      tails.set(name, turn.then(noop, noop));
      return turn;
    },
  };
}
