import { createClientIdentitySource } from '@/platform/client-identity';
import { systemClock } from '@/platform/clock';
import { createPlatformHttpClient } from '@/platform/http';
import { uuidGenerator } from '@/platform/ids';
import { consoleLogger } from '@/platform/log';
import { createNetworkMonitor } from '@/platform/network';
import { createConnectionService } from '@/services/connections';
import { createDevicePlugins } from '@/services/device-plugins';
import { createHomeLayoutService } from '@/services/home-layout';
import type { Services } from '@/services';
import { createMediaService } from '@/services/media';
import { createProviderPool } from '@/services/media/pool';
import { createPinService } from '@/services/pins';
import { createPluginCatalog } from '@/services/plugin-catalog';
import { createProfileService } from '@/services/profiles';
import { createSecretJanitor } from '@/services/secrets';
import { createSessionService } from '@/services/session';
import { createSessions } from '@/services/sessions';
import { createSourceService } from '@/services/sources';

import { plugins } from './plugins';
import { createStorage } from './storage';

export interface AppServices {
  readonly services: Services;
  /** What launching does, once: clear what a crash left queued, then decide the first screen. */
  readonly start: () => Promise<void>;
}

/** Builds the whole service graph. The only place concrete implementations are chosen. */
export function createServices(): AppServices {
  const log = consoleLogger;
  const clock = systemClock;
  const ids = uuidGenerator;
  const { db, credentials, deviceBound } = createStorage({ clock, ids, log });
  const network = createNetworkMonitor();
  const sessions = createSessions(deviceBound);
  const janitor = createSecretJanitor({ db, stores: [credentials, deviceBound], log });

  const catalog = createPluginCatalog(plugins, { strict: __DEV__, warn: (message) => log.warn('app.boot', message) });
  const devicePlugins = createDevicePlugins(db.deviceSettings);
  const pins = createPinService({ db, credentials, janitor, ids, clock });
  const session = createSessionService({ users: db.users, deviceSettings: db.deviceSettings, pins });
  const sources = createSourceService({ catalog, devicePlugins, connections: db.connections });
  const pool = createProviderPool({
    catalog,
    credentials,
    sessions,
    http: createPlatformHttpClient(network, log),
    network,
    identity: createClientIdentitySource(deviceBound, log),
    clock,
    log,
  });
  const connections = createConnectionService({
    db,
    credentials,
    catalog,
    janitor,
    ids,
    onChanged: (id) => pool.forgetConnection(id),
  });
  const media = createMediaService({
    sources,
    pool,
    probeSecrets: connections.probeSecrets,
    network,
    cache: db.mediaCache,
    clock,
    log,
  });
  const profiles = createProfileService({ db, janitor, session, ids, onRemoved: (id) => media.forgetUser(id) });
  const homeLayout = createHomeLayoutService(db.preferences);

  return {
    services: { catalog, devicePlugins, session, profiles, pins, connections, sources, homeLayout, media },
    start: async () => {
      await janitor.drain();
      // A storage failure lands on the boot screen's "could not start", never on an endless splash.
      await session.start();
      void media.prune();
    },
  };
}
