import type { Clock } from '@/services/ports';

/** What the repositories of either engine are built with, per transaction. */
export interface WriteOptions {
  readonly clock: Clock;
  /** Off for what arrives from the account: it is not this device's change, and would be sent straight back. */
  readonly journaled: boolean;
  /** Told of every entry written, so the database can say, once committed, that the journal grew. */
  readonly onJournaled?: () => void;
}
