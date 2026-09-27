import {
  AppError,
  connectionId as toConnectionId,
  type ConnectedUserStateSyncProvider,
  type Connection,
  type Credentials,
  type FieldValues,
  type PluginId,
} from '@sc/api';

import { stableJson } from '../hash';
import { pluginContext, secretsOf, type PluginContextDeps } from '../plugin-context';
import type { PluginCatalog } from '../plugin-catalog';
import type { SecureCredentialStore } from '../ports';
import { sessionIdentity, type Sessions } from '../sessions';

/** A provider outside the pool, and the session it signed in with — the account's own, once it is saved. */
export interface Probe {
  readonly provider: ConnectedUserStateSyncProvider;
  readonly session: () => Promise<string | undefined>;
}

/** The account's one connected provider, replaced when the connection's values change. */
export interface AccountProviders {
  provider(account: Connection): Promise<ConnectedUserStateSyncProvider>;
  /** To try a sign-in before anything is saved. The caller disposes it. */
  probe(pluginId: PluginId, values: { readonly fields: FieldValues; readonly settings: FieldValues }, credentials: Credentials): Promise<Probe>;
  /** The account changed or went. */
  forget(): void;
}

/**
 * One installation id for a plugin's account on this device, the probe's and
 * the account's alike: the server keeps one device row per installation, so
 * signing in and then syncing is one device, not two.
 */
const installationOf = (pluginId: PluginId) => `account|${pluginId}`;

export function createAccountProviders(
  deps: PluginContextDeps & {
    readonly catalog: PluginCatalog;
    readonly credentials: SecureCredentialStore;
    readonly sessions: Sessions;
  },
): AccountProviders {
  let entry: { readonly key: string; readonly ready: Promise<ConnectedUserStateSyncProvider> } | undefined;

  const roleOf = (pluginId: PluginId) => {
    const role = deps.catalog.syncRole(pluginId);
    const manifest = deps.catalog.get(pluginId);
    if (!role || !manifest) throw new AppError('INVALID_STATE', 'This account cannot be used in this version of the app.', { retry: 'never' });
    return { role, manifest };
  };

  const connect = async (account: Connection) => {
    const { role, manifest } = roleOf(account.pluginId);
    // Its session is kept apart from the media role's, even on one connection.
    return role.connect(
      { connectionId: account.id, fields: account.values.fields, settings: account.values.settings },
      await pluginContext(
        deps,
        installationOf(account.pluginId),
        secretsOf(deps.credentials, account.values),
        deps.sessions.bind(account.id, 'account', sessionIdentity(manifest, account.values)),
      ),
    );
  };

  const dispose = (ready: Promise<ConnectedUserStateSyncProvider>) => {
    ready.then((provider) => provider.dispose()).catch(() => undefined);
  };

  return {
    provider: (account) => {
      const key = stableJson([account.id, account.pluginId, account.values]);
      if (entry?.key === key) return entry.ready;
      if (entry) dispose(entry.ready);
      const ready = connect(account);
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
      const provider = await role.connect(
        { connectionId: toConnectionId('probe'), fields: values.fields, settings: values.settings },
        await pluginContext(deps, installationOf(pluginId), async () => credentials, session),
      );
      return { provider, session: () => session.read() };
    },
    forget: () => {
      if (entry) dispose(entry.ready);
      entry = undefined;
    },
  };
}
