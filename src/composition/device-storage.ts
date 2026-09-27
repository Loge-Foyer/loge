import type { Clock, IdGenerator, Logger, SecureCredentialStore, SyncDatabase } from '@/services/ports';

/** Where this device keeps things. `storage.ts` builds it on native, `storage.web.ts` in a browser. */
export interface DeviceStorage {
  readonly db: SyncDatabase;
  /** Passwords and PINs. An encrypted backup restored onto another phone may bring them along. */
  readonly credentials: SecureCredentialStore;
  /** Session tokens and the device key, which must never reach another phone. */
  readonly deviceBound: SecureCredentialStore;
}

export interface StorageDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly log: Logger;
}
