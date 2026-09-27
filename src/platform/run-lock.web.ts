import type { RunLock } from '@/services/ports';

import { createInProcessLock } from './in-process-lock';

/**
 * Tabs of one browser share one database, and must not sync at once: the Web
 * Locks API holds a lock across them. Where it is missing, only this tab is
 * held — the checkpoint and cursor still guard against the other.
 */
export function createRunLock(): RunLock {
  const locks = globalThis.navigator?.locks;
  if (!locks) return createInProcessLock();
  return {
    run: (name, work) => locks.request(name, () => work()),
  };
}
