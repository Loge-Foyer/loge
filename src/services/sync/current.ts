import { effectiveRoles, type Connection, type PluginManifest, type SyncCapability } from '@sc/api';

import type { PluginCatalog } from '../plugin-catalog';
import type { LocalDatabase } from '../ports';

/** The device's account: the one connection with its sync role on. */
export interface CurrentAccount {
  readonly connection: Connection;
  readonly manifest?: PluginManifest;
  /** Whether this build can run it — its plugin is registered here, with a sync role. */
  readonly available: boolean;
  /** What it carries: everything its plugin declares, less any toggle switched off. */
  readonly carried: ReadonlySet<SyncCapability>;
}

export async function currentAccount(db: LocalDatabase, catalog: PluginCatalog): Promise<CurrentAccount | undefined> {
  const connection = (await db.connections.list()).find((candidate) => candidate.roles.sync === true);
  if (!connection) return undefined;
  const manifest = catalog.get(connection.pluginId);
  const available = manifest !== undefined && catalog.syncRole(connection.pluginId) !== undefined;
  const carried = manifest
    ? (effectiveRoles(manifest, { roles: connection.roles, settings: connection.values.settings }).sync?.capabilities ?? new Set<SyncCapability>())
    : new Set<SyncCapability>();
  return { connection, ...(manifest ? { manifest } : {}), available, carried };
}
