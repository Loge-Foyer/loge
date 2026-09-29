import { createAppActivity } from '@/platform/app-activity';
import { createClientIdentitySource } from '@/platform/client-identity';
import { systemClock } from '@/platform/clock';
import { hostCrypto } from '@/platform/crypto';
import { createPlatformHttpClient } from '@/platform/http';
import { uuidGenerator } from '@/platform/ids';
import { consoleLogger } from '@/platform/log';
import { createNetworkMonitor } from '@/platform/network';
import { createOwnerAuthentication } from '@/platform/owner-authentication';
import { currentPlatform } from '@/platform/platform-id';
import { createRunLock } from '@/platform/run-lock';
import { createAccountService } from '@/services/account';
import { createConnectionService } from '@/services/connections';
import { createDevicePlugins } from '@/services/device-plugins';
import { createHomeLayoutService } from '@/services/home-layout';
import type { Services } from '@/services';
import { createMediaService } from '@/services/media';
import { createProviderPool } from '@/services/media/pool';
import { accountOwnerCheck, createOwnerCheck } from '@/services/owner-check';
import { createPinService } from '@/services/pins';
import { createPluginCatalog } from '@/services/plugin-catalog';
import { createProfileService } from '@/services/profiles';
import { createSecretJanitor } from '@/services/secrets';
import { createSessionService } from '@/services/session';
import { createSessions } from '@/services/sessions';
import { createSourceService } from '@/services/sources';
import type { SyncParts } from '@/services/sync/apply';
import { createSyncEngine } from '@/services/sync/engine';
import { createAccountProviders } from '@/services/sync/provider';
import { createSyncScheduler } from '@/services/sync/scheduler';

import { plugins } from './plugins';
import { createStorage } from './storage';

export interface AppServices {
  readonly services: Services;
  /** What launching does, once: clear what a crash left queued, decide the first screen, then start syncing. */
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

  const catalog = createPluginCatalog(plugins, {
    platform: currentPlatform(),
    strict: __DEV__,
    warn: (message) => log.warn('app.boot', message),
  });
  const devicePlugins = createDevicePlugins(db.deviceSettings);
  const http = createPlatformHttpClient(network, log);
  const identity = createClientIdentitySource(deviceBound, log);
  const crypto = hostCrypto;
  const accountProviders = createAccountProviders({ http, network, identity, clock, crypto, catalog, credentials, sessions });
  const parts: SyncParts = { db, credentials, catalog, ids, janitor, crypto, log };
  const lock = createRunLock();
  const engine = createSyncEngine({ parts, providers: accountProviders, lock, clock });
  const owner = createOwnerCheck({
    account: accountOwnerCheck({ db, catalog, providers: accountProviders, status: engine.status }),
    device: createOwnerAuthentication(),
    log,
  });
  const pins = createPinService({ db, credentials, janitor, ids, clock, owner });
  const session = createSessionService({ users: db.users, deviceSettings: db.deviceSettings, pins });
  const sources = createSourceService({ catalog, devicePlugins, connections: db.connections });
  const pool = createProviderPool({ catalog, credentials, sessions, http, network, identity, clock, crypto, log });
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

  const scheduler = createSyncScheduler({ engine, journal: db.journal, network, activity: createAppActivity() });
  const account = createAccountService({
    db,
    catalog,
    connections,
    owner,
    providers: accountProviders,
    engine,
    scheduler,
    janitor,
    lock,
    parts,
    sessions,
  });
  // What the account brought: running providers let changed connections and removed profiles go, and the gate looks again.
  engine.onApplied((applied) => {
    for (const id of applied.connections) pool.forgetConnection(id);
    for (const id of applied.removedProfiles) media.forgetUser(id);
    void session.refresh();
  });

  return {
    services: {
      catalog,
      devicePlugins,
      session,
      profiles,
      pins,
      connections,
      sources,
      homeLayout,
      media,
      account,
      owner,
      sync: { status: engine.status, subscribe: engine.subscribe, onApplied: engine.onApplied, now: scheduler.now },
    },
    start: async () => {
      await janitor.drain();
      // A storage failure lands on the boot screen's "could not start", never on an endless splash.
      await session.start();
      void media.prune();
      scheduler.start();
    },
  };
}
