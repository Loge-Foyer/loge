import type { RunLock } from '@/services/ports';

import { createInProcessLock } from './in-process-lock';

/** A phone runs one copy of the app, so a lock within this runtime is the lock. The web build uses `run-lock.web.ts`. */
export function createRunLock(): RunLock {
  return createInProcessLock();
}
