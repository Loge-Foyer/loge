import type { ConnectionId, UserId } from '@sc/api';

import type { PluginCatalog } from '../plugin-catalog';
import type { IdGenerator, Logger, SecureCredentialStore, SyncDatabase } from '../ports';
import type { SecretJanitor } from '../secrets';

/** What the sync engine works with. */
export interface SyncParts {
  readonly db: SyncDatabase;
  readonly credentials: SecureCredentialStore;
  readonly catalog: PluginCatalog;
  readonly ids: IdGenerator;
  readonly janitor: SecretJanitor;
  readonly log: Logger;
}

/** What applying the account changed — for whatever holds on to something that depends on it. */
export interface Applied {
  readonly connections: ReadonlySet<ConnectionId>;
  readonly removedProfiles: ReadonlySet<UserId>;
  readonly arrivedProfiles: ReadonlySet<UserId>;
  /** Anything at all: profiles, PINs, preferences, connections. */
  readonly changed: boolean;
}
