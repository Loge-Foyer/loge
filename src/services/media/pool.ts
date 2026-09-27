import {
  AppError,
  connectionId as toConnectionId,
  MEDIA_CAPABILITY_MEMBERS,
  type ConnectedMediaProvider,
  type ConnectionId,
  type Credentials,
  type FieldValues,
  type HttpClient,
  type PluginId,
  type UserId,
} from '@sc/api';

import { stableJson } from '../hash';
import { pluginContext, secretsOf } from '../plugin-context';
import type { PluginCatalog } from '../plugin-catalog';
import type { ClientIdentitySource, Clock, Logger, NetworkMonitor, SecureCredentialStore } from '../ports';
import { sessionIdentity, type Sessions } from '../sessions';
import type { Source } from '../sources';

interface Entry {
  readonly fingerprint: string;
  readonly ready: Promise<ConnectedMediaProvider>;
  provider?: ConnectedMediaProvider;
  /** Set when trying again cannot help until something changes. */
  parked?: AppError;
}

/**
 * What a source runs with, as one string: a provider is replaced when it
 * changes, and nothing saved under another one is served. Secrets never enter
 * it — a changed secret gets a new credentials ref, and that does.
 */
export function fingerprintOf(source: Source): string {
  return stableJson([source.connection.perProfile, source.values.fields, source.values.settings, source.values.credentialsRef ?? null]);
}

/** A draft to try out: its values, and the secrets it signs in with. */
export interface ProbeConnection {
  readonly pluginId: PluginId;
  readonly fields: FieldValues;
  readonly settings: FieldValues;
  readonly credentials: Credentials;
}

export interface ProviderPool {
  /** The running provider for a source, connected — or replaced — as its values require. */
  provider(source: Source): Promise<ConnectedMediaProvider>;
  /** The provider if it is already connected, for work that cannot wait, such as building an image address. */
  connected(source: Source): ConnectedMediaProvider | undefined;
  parked(source: Source): AppError | undefined;
  park(source: Source, error: AppError): void;
  unparkAll(): void;
  /** A provider outside the pool, for testing a draft. The caller disposes it. */
  probe(connection: ProbeConnection): Promise<ConnectedMediaProvider>;
  forgetConnection(id: ConnectionId): void;
  forgetUser(id: UserId): void;
}

/**
 * One provider per connection and set of credentials. Every profile that
 * shares a login shares its provider and its session: a provider each would
 * sign in again and again, each sign-in ending the last one's session.
 */
export function createProviderPool(deps: {
  catalog: PluginCatalog;
  credentials: SecureCredentialStore;
  sessions: Sessions;
  http: HttpClient;
  network: NetworkMonitor;
  identity: ClientIdentitySource;
  clock: Clock;
  log: Logger;
}): ProviderPool {
  const entries = new Map<string, Entry>();
  const keyOf = (source: Source) => `${source.connection.id}|${source.scope}`;


  const roleOf = (pluginId: PluginId, name: string) => {
    const role = deps.catalog.mediaRole(pluginId);
    if (!role) throw new AppError('INVALID_STATE', `${name} cannot list anything yet.`, { retry: 'never' });
    return role;
  };

  const connect = async (source: Source): Promise<ConnectedMediaProvider> => {
    const role = roleOf(source.manifest.id, source.manifest.displayName);
    const provider = await role.connect(
      { connectionId: source.connection.id, fields: source.values.fields, settings: source.values.settings },
      await pluginContext(
        deps,
        `${source.connection.id}|${source.scope}`,
        secretsOf(deps.credentials, source.values),
        deps.sessions.bind(source.connection.id, source.scope, sessionIdentity(source.manifest, source.values)),
      ),
    );
    for (const capability of source.effective.media?.capabilities ?? []) {
      for (const member of MEDIA_CAPABILITY_MEMBERS[capability] ?? []) {
        if (typeof provider[member] !== 'function') {
          deps.log.warn('provider', `${source.manifest.id} declares ${capability} without ${member}`);
        }
      }
    }
    return provider;
  };

  const dispose = (entry: Entry) => {
    entry.ready.then((provider) => provider.dispose()).catch(() => undefined);
  };

  const current = (source: Source) => {
    const entry = entries.get(keyOf(source));
    return entry?.fingerprint === fingerprintOf(source) ? entry : undefined;
  };

  const forget = (matches: (key: string) => boolean) => {
    for (const [key, entry] of entries) {
      if (!matches(key)) continue;
      dispose(entry);
      entries.delete(key);
    }
  };

  return {
    provider: (source) => {
      const existing = current(source);
      if (existing) return existing.ready;
      const key = keyOf(source);
      const stale = entries.get(key);
      if (stale) dispose(stale);
      const entry: Entry = { fingerprint: fingerprintOf(source), ready: connect(source) };
      entry.ready.then(
        (provider) => {
          entry.provider = provider;
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );
      entries.set(key, entry);
      return entry.ready;
    },
    connected: (source) => current(source)?.provider,
    parked: (source) => current(source)?.parked,
    park: (source, error) => {
      const entry = current(source);
      if (entry) entry.parked = error;
    },
    unparkAll: () => {
      for (const entry of entries.values()) delete entry.parked;
    },
    probe: async (connection) => {
      const manifest = deps.catalog.get(connection.pluginId);
      const role = roleOf(connection.pluginId, manifest?.displayName ?? 'This source');
      // Its own installation id: a probe signing in never ends a running provider's session.
      return role.connect(
        { connectionId: toConnectionId('probe'), fields: connection.fields, settings: connection.settings },
        await pluginContext(deps, `probe|${connection.pluginId}`, async () => connection.credentials, deps.sessions.ephemeral()),
      );
    },
    forgetConnection: (id) => forget((key) => key.startsWith(`${id}|`)),
    forgetUser: (id) => forget((key) => key.endsWith(`|${id}`)),
  };
}

