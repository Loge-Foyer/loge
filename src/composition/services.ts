import { categoryOfPluginId } from '@sc/api';

import { backupSql } from '@/persistence/backup/sql';
import { createAppActivity } from '@/platform/app-activity';
import { createClientIdentitySource } from '@/platform/client-identity';
import { createFileStore } from '@/platform/downloads';
import { createFileExchange } from '@/platform/file-exchange';
import { systemClock } from '@/platform/clock';
import { hostCrypto } from '@/platform/crypto';
import { createPlatformHttpClient } from '@/platform/http';
import { uuidGenerator } from '@/platform/ids';
import { consoleLogger } from '@/platform/log';
import { createNetworkMonitor } from '@/platform/network';
import { createOwnerAuthentication } from '@/platform/owner-authentication';
import { currentPlatform, isTV } from '@/platform/platform-id';
import { createRunLock } from '@/platform/run-lock';
import { screenBrightness } from '@/platform/brightness';
import { pictureInPicture } from '@/platform/picture-in-picture';
import { screenOrientation } from '@/platform/screen-orientation';
import { createAccountService } from '@/services/account';
import { createBackupService } from '@/services/backup';
import { createBackupTargets } from '@/services/backup/targets';
import { createConnectionService } from '@/services/connections';
import { createHomeLayoutService } from '@/services/home-layout';
import type { Services } from '@/services';
import { createMediaService } from '@/services/media';
import { createProviderPool } from '@/services/media/pool';
import { accountOwnerCheck, createOwnerCheck } from '@/services/owner-check';
import { createPinService } from '@/services/pins';
import { createPlaybackService } from '@/services/playback';
import { appDefaults, createAppSettingsService } from '@/services/app-settings';
import { createPlayerService } from '@/services/players';
import { createPluginCatalog } from '@/services/plugin-catalog';
import { createProfileService } from '@/services/profiles';
import { checkRestoredDevice } from '@/services/restored-device';
import { createSecretJanitor } from '@/services/secrets';
import { createSessionService } from '@/services/session';
import { createSessions } from '@/services/sessions';
import { createSourceService } from '@/services/sources';
import { createSyncEngine } from '@/services/sync/engine';
import type { SyncParts } from '@/services/sync/parts';
import { createAccountProviders } from '@/services/sync/provider';
import { createSyncScheduler } from '@/services/sync/scheduler';
import { createWatchService } from '@/services/watch';
import { createDownloadService } from '@/services/downloads';
import { createListsService } from '@/services/lists';
import { createDownloadQueue } from '@/services/downloads/queue';
import { createDownloadSettingsService } from '@/services/downloads/settings';
import { createOutboxDrainer } from '@/services/watch/drainer';

import { playerDefaults, players as playerPlugins, plugins } from './plugins';
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
  const { db, credentials, deviceBound } = createStorage({ clock, log });
  const network = createNetworkMonitor();
  const sessions = createSessions(deviceBound);
  const janitor = createSecretJanitor({ db, stores: [credentials, deviceBound], log });

  const catalog = createPluginCatalog(plugins, {
    platform: currentPlatform(),
    strict: __DEV__,
    warn: (message) => log.warn('app.boot', message),
  });
  const http = createPlatformHttpClient(network, log);
  const identity = createClientIdentitySource(deviceBound, log);
  const crypto = hostCrypto;
  const accountProviders = createAccountProviders({ http, network, identity, clock, crypto, catalog, credentials, sessions });
  const parts: SyncParts = { db, credentials, catalog, ids, janitor, log };
  const lock = createRunLock();
  const engine = createSyncEngine({ parts, providers: accountProviders, lock, clock });
  const owner = createOwnerCheck({
    account: accountOwnerCheck({ db, catalog, providers: accountProviders, status: engine.status }),
    device: createOwnerAuthentication(),
    log,
  });
  const pins = createPinService({ db, credentials, janitor, ids, clock, owner });
  const appSettings = createAppSettingsService({ deviceSettings: db.deviceSettings, defaults: appDefaults({ tv: isTV() }) });
  const session = createSessionService({ users: db.users, deviceSettings: db.deviceSettings, account: db.account, pins, appSettings });
  const sources = createSourceService({ catalog, connections: db.connections });
  const pool = createProviderPool({ catalog, credentials, sessions, http, network, identity, clock, crypto, log });
  const connections = createConnectionService({
    db,
    credentials,
    catalog,
    janitor,
    ids,
    onChanged: (id) => pool.forgetConnection(id),
  });
  const activity = createAppActivity();
  const drainer = createOutboxDrainer({ outbox: db.outbox, sources, pool, network, activity, clock, log });
  const watch = createWatchService({ db, sources, clock, onQueued: () => drainer.kick() });
  const lists = createListsService({ db, ids, clock });
  const downloadSettings = createDownloadSettingsService({ deviceSettings: db.deviceSettings });
  const files = createFileStore();
  const downloadQueue = createDownloadQueue({
    downloads: db.downloads,
    files,
    sources,
    pool,
    network,
    activity,
    clock,
    log,
    onlyOnWifi: async () => (await downloadSettings.get()).onlyOnWifi,
  });
  const downloads = createDownloadService({
    downloads: db.downloads,
    files,
    sources,
    pool,
    limitBytes: async () => (await downloadSettings.get()).maxBytes,
    ids,
    clock,
    log,
    onQueued: () => downloadQueue.kick(),
  });
  const media = createMediaService({
    sources,
    pool,
    probeSecrets: connections.probeSecrets,
    network,
    cache: db.mediaCache,
    watch,
    kept: db.downloads,
    clock,
    log,
  });
  const profiles = createProfileService({ db, janitor, session, ids, onRemoved: (id) => media.forgetUser(id) });
  const homeLayout = createHomeLayoutService(db.preferences);

  const scheduler = createSyncScheduler({ engine, journal: db.journal, network, activity });
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
    ids,
  });
  const backup = createBackupService({
    db,
    deviceBound,
    crypto,
    sql: backupSql,
    parts,
    catalog,
    owner,
    account,
    engine,
    scheduler,
    lock,
    janitor,
    clock,
    identity: () => identity.identity(),
  });
  const backupTargets = createBackupTargets({
    http,
    network,
    identity,
    clock,
    crypto,
    db,
    catalog,
    credentials,
    sessions,
    backup,
    journal: db.journal,
    activity,
    ids,
    log,
  });
  const players = createPlayerService({
    catalog,
    deviceSettings: db.deviceSettings,
    platform: currentPlatform(),
    shrinksAnything: () => pictureInPicture.available(),
    defaults: playerDefaults,
  });
  const playback = createPlaybackService({
    players: playerPlugins,
    choosing: players.choosing,
    categoryOf: async (id) => {
      const connection = await db.connections.get(id);
      return connection ? categoryOfPluginId(connection.pluginId) : undefined;
    },
    media,
    watch,
    downloads,
    clock,
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
      session,
      profiles,
      pins,
      connections,
      sources,
      homeLayout,
      // Pull to refresh tries parked sources again: the outbox's reports too.
      media: {
        ...media,
        unpark: () => {
          media.unpark();
          drainer.kick();
        },
      },
      account,
      owner,
      sync: { status: engine.status, subscribe: engine.subscribe, onApplied: engine.onApplied, now: scheduler.now },
      backup,
      backupTargets,
      files: createFileExchange(log),
      players,
      appSettings,
      watch,
      downloads,
      downloadSettings,
      lists,
      playback,
      orientation: screenOrientation,
      brightness: screenBrightness,
      pictureInPicture,
    },
    start: async () => {
      // Upright, as every screen but the player's is laid out; iOS starts that way already.
      void screenOrientation.upright().catch(() => undefined);
      // Before anything reads the journal: another phone's, restored here, is never sent.
      await checkRestoredDevice({ db, deviceKey: async () => (await identity.identity()).deviceKey, sha256: crypto.sha256, log }).catch((error: unknown) =>
        log.error('app.boot', 'The device key could not be checked', { error: String(error) }),
      );
      await janitor.drain();
      // A device from before the account model keeps its profiles, as an account kept here.
      await account.ensureAccount().catch((error: unknown) => log.error('app.boot', 'The account could not be set up', { error: String(error) }));
      // A storage failure lands on the boot screen's "could not start", never on an endless splash.
      await session.start();
      void media.prune();
      void watch.prune().catch((error: unknown) => log.warn('storage', 'Old watch state could not be pruned', { error: String(error) }));
      scheduler.start();
      backupTargets.start();
      drainer.start();
      downloadQueue.start();
    },
  };
}
