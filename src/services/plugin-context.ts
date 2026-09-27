import { AppError, type ConnectionValues, type Credentials, type HttpClient, type PluginContext, type PluginCrypto } from '@sc/api';

import { stableHash } from './hash';
import type { ClientIdentitySource, Clock, NetworkMonitor, SecureCredentialStore } from './ports';

/**
 * A row says a password is saved, and the credential store does not have it —
 * a backup restored the database but not the keychain, or the connection came
 * from another device. Signing in without it would count as a failed login,
 * and servers lock accounts after a few.
 */
export class MissingSecretError extends AppError {
  constructor() {
    super('UNAUTHORIZED', 'The saved password is not on this device.', { retry: 'never' });
    this.name = 'MissingSecretError';
  }
}

export interface PluginContextDeps {
  readonly http: HttpClient;
  readonly network: NetworkMonitor;
  readonly identity: ClientIdentitySource;
  readonly clock: Clock;
  readonly crypto: PluginCrypto;
}

/** Everything a plugin may use from the host, for one connection, role and credential scope. */
export async function pluginContext(
  deps: PluginContextDeps,
  installationScope: string,
  read: () => Promise<Credentials>,
  session: PluginContext['session'],
): Promise<PluginContext> {
  const client = await deps.identity.identity();
  return {
    http: deps.http,
    credentials: { read },
    session,
    network: { current: () => deps.network.current() },
    client: {
      appName: client.appName,
      appVersion: client.appVersion,
      deviceName: client.deviceName,
      installationId: stableHash(`${client.deviceKey}|${installationScope}`),
    },
    clock: { now: () => deps.clock.now(), sleep: (ms, signal) => deps.clock.sleep(ms, signal) },
    crypto: deps.crypto,
  };
}

/** The password fields a set of values signs in with — refusing, rather than signing in without, one that is missing. */
export function secretsOf(store: SecureCredentialStore, values: ConnectionValues): () => Promise<Credentials> {
  const ref = values.credentialsRef;
  const saved = values.secretKeys ?? [];
  return async () => {
    const secrets = (ref && (await store.read(ref))) || {};
    if (saved.some((key) => secrets[key] === undefined)) throw new MissingSecretError();
    return secrets;
  };
}
