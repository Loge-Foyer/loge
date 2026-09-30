import type { Connection, PluginManifest } from '@sc/api';

import type { PluginCatalog } from '../plugin-catalog';
import type { LocalDatabase } from '../ports';

/** The device's account, as it stands. */
export type CurrentAccount =
  | { readonly kind: 'local'; readonly id: string; readonly name: string }
  | {
      readonly kind: 'server';
      readonly id: string;
      readonly name: string;
      readonly maxProfiles: number;
      readonly connection: Connection;
      readonly manifest?: PluginManifest;
      /** Whether this build can reach it: its plugin is registered here, with an account role. */
      readonly available: boolean;
    };

export async function currentAccount(db: LocalDatabase, catalog: PluginCatalog): Promise<CurrentAccount | undefined> {
  const account = await db.account.get();
  if (!account) return undefined;
  if (account.kind === 'local') return account;
  const connection = await db.connections.get(account.connectionId);
  // Its connection gone would be a bug; the account then holds what the device holds, as a local one.
  if (!connection) return { kind: 'local', id: account.id, name: account.name };
  const manifest = catalog.get(connection.pluginId);
  return {
    ...account,
    connection,
    ...(manifest ? { manifest } : {}),
    available: manifest !== undefined && catalog.accountRole(connection.pluginId) !== undefined,
  };
}
