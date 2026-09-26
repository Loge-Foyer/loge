import { createConnectionService } from '@/services/connections';
import { createDevicePlugins } from '@/services/device-plugins';
import { createHomeLayoutService } from '@/services/home-layout';
import type { Services } from '@/services';
import { createMediaService } from '@/services/media';
import { createProviderPool } from '@/services/media/pool';
import { createPinService } from '@/services/pins';
import { createPluginCatalog } from '@/services/plugin-catalog';
import { createProfileService } from '@/services/profiles';
import { createSessionService } from '@/services/session';
import { createSessions } from '@/services/sessions';
import { createSourceService } from '@/services/sources';
import { createMemoryStores } from '@/persistence/memory';
import { createClientIdentitySource } from '@/platform/client-identity';
import { systemClock } from '@/platform/clock';
import { createMemoryCredentialStore } from '@/platform/credential-store';
import { createPlatformHttpClient } from '@/platform/http';
import { uuidGenerator } from '@/platform/ids';
import { consoleLogger } from '@/platform/log';
import { createNetworkMonitor } from '@/platform/network';

import { plugins } from './plugins';

/** Builds the whole service graph. The only place concrete implementations are chosen. */
export function createServices(): Services {
  const stores = createMemoryStores();
  const credentials = createMemoryCredentialStore();
  const ids = uuidGenerator;
  const log = consoleLogger;
  const network = createNetworkMonitor();
  const sessions = createSessions(credentials);

  const catalog = createPluginCatalog(plugins, { strict: __DEV__, warn: (message) => log.warn('app.boot', message) });
  const devicePlugins = createDevicePlugins(stores.deviceSettings);
  const pins = createPinService({ users: stores.users, credentials, ids, clock: systemClock });
  const session = createSessionService({ users: stores.users, deviceSettings: stores.deviceSettings, pins });
  const sources = createSourceService({ catalog, devicePlugins, connections: stores.connections });
  const pool = createProviderPool({
    catalog,
    credentials,
    sessions,
    http: createPlatformHttpClient(network, log),
    network,
    identity: createClientIdentitySource(),
    clock: systemClock,
    log,
  });
  const connections = createConnectionService({
    connections: stores.connections,
    users: stores.users,
    credentials,
    catalog,
    sessions,
    ids,
    onChanged: (id) => pool.forgetConnection(id),
  });
  const media = createMediaService({ sources, pool, probeSecrets: connections.probeSecrets, network, log });
  const profiles = createProfileService({
    users: stores.users,
    connections: stores.connections,
    credentials,
    sessions,
    deviceSettings: stores.deviceSettings,
    session,
    ids,
    onRemoved: (id) => media.forgetUser(id),
  });
  const homeLayout = createHomeLayoutService(stores.preferences);

  return { catalog, devicePlugins, session, profiles, pins, connections, sources, homeLayout, media };
}
