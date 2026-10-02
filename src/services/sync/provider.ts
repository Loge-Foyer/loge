import {
  AppError,
  connectionId as toConnectionId,
  type ConnectedAccount,
  type Connection,
  type Credentials,
  type FieldValues,
  type PluginId,
} from '@loge/api';

import { stableJson } from '../hash';
import { pluginContext, secretsOf, type PluginContextDeps } from '../plugin-context';
import type { PluginCatalog } from '../plugin-catalog';
import type { SecureCredentialStore } from '../ports';
import { sessionIdentity, type Sessions } from '../sessions';

/** An account outside the pool, and the session it signed in with — the account's own, once it is saved. */
export interface Probe {
  readonly account: ConnectedAccount;
  readonly session: () => Promise<string | undefined>;
}

/** The account's one connected provider, replaced when its connection's values change. */
export interface AccountProviders {
  provider(connection: Connection): Promise<ConnectedAccount>;
  /** To try a sign-in before anything is saved. The caller disposes it. */
  probe(pluginId: PluginId, values: { readonly fields: FieldValues; readonly settings: FieldValues }, credentials: Credentials): Promise<Probe>;
  /** The account changed or went. */
  forget(): void;
}

/**
 * One installation id for a plugin's account on this device, the probe's and
 * the account's alike: signing in and then syncing is one device, not two.
 */
const installationOf = (pluginId: PluginId) => `account|${pluginId}`;

export function createAccountProviders(
  deps: PluginContextDeps & {
    readonly catalog: PluginCatalog;
    readonly credentials: SecureCredentialStore;
    readonly sessions: Sessions;
  },
): AccountProviders {
  let entry: { readonly key: string; readonly ready: Promise<ConnectedAccount> } | undefined;

  const roleOf = (pluginId: PluginId) => {
    const role = deps.catalog.accountRole(pluginId);
    const manifest = deps.catalog.get(pluginId);
    if (!role || !manifest) throw new AppError('INVALID_STATE', 'This account cannot be used in this version of the app.', { retry: 'never' });
    return { role, manifest };
  };

  const connect = async (connection: Connection) => {
    const { role, manifest } = roleOf(connection.pluginId);
    return role.connect(
      { connectionId: connection.id, fields: connection.values.fields, settings: connection.values.settings },
      await pluginContext(
        deps,
        installationOf(connection.pluginId),
        secretsOf(deps.credentials, connection.values),
        deps.sessions.bind(connection.id, 'account', sessionIdentity(manifest, connection.values)),
      ),
    );
  };

  const dispose = (ready: Promise<ConnectedAccount>) => {
    ready.then((account) => account.dispose()).catch(() => undefined);
  };

  return {
    provider: (connection) => {
      const key = stableJson([connection.id, connection.pluginId, connection.values]);
      if (entry?.key === key) return entry.ready;
      if (entry) dispose(entry.ready);
      const ready = connect(connection);
      const created = { key, ready };
      entry = created;
      ready.catch(() => {
        if (entry === created) entry = undefined;
      });
      return ready;
    },
    probe: async (pluginId, values, credentials) => {
      const { role } = roleOf(pluginId);
      // No saved session: trying a sign-in never touches a running one. What it signs in with is kept, for the account to take.
      const session = deps.sessions.ephemeral();
      const account = await role.connect(
        { connectionId: toConnectionId('probe'), fields: values.fields, settings: values.settings },
        await pluginContext(deps, installationOf(pluginId), async () => credentials, session),
      );
      return { account, session: () => session.read() };
    },
    forget: () => {
      if (entry) dispose(entry.ready);
      entry = undefined;
    },
  };
}
