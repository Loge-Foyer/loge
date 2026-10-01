// The service graph as the composition root builds it, with only the device
// boundary faked: ids, clock, network, identity, the keychain and the HTTP
// client. Every service is the real one, on the real database engine.
import {
  AppError,
  categoryOfPluginId,
  compareItems,
  matchesTerm,
  pluginId,
  type ConnectedMediaProvider,
  type HttpClient,
  type MediaItem,
  type GlobalMediaKey,
  type Movie,
  type PlatformId,
  type Plugin,
  type PluginManifest,
  type ConnectionId,
  type ProgressReport,
  type PlaybackDescriptor,
  type DownloadRequest,
  type PlaybackRequest,
  type PlayerProfile,
  type MediaPlayer,
  type PlayerContext,
} from '@sc/api';
import type { PlayerPlugin } from '@sc/player-kit';

import initSqlJs from 'sql.js';

import { createSqlJsBackup } from '@/persistence/backup/sql-js';
import { createInProcessLock } from '@/platform/in-process-lock';
import { createAccountService } from '@/services/account';
import { createBackupService } from '@/services/backup';
import { createBackupTargets } from '@/services/backup/targets';
import { createConnectionService } from '@/services/connections';
import { createHomeLayoutService } from '@/services/home-layout';
import { createMediaService } from '@/services/media';
import { createProviderPool } from '@/services/media/pool';
import { accountOwnerCheck, createOwnerCheck } from '@/services/owner-check';
import { createPinService } from '@/services/pins';
import { createAppSettingsService } from '@/services/app-settings';
import { createPlayerService } from '@/services/players';
import { createPluginCatalog } from '@/services/plugin-catalog';
import type { FileExchange, FileStore, TransferRequest } from '@/services/ports';
import { createProfileService } from '@/services/profiles';
import { createSecretJanitor } from '@/services/secrets';
import { createSessionService } from '@/services/session';
import { createSessions } from '@/services/sessions';
import { createSourceService } from '@/services/sources';
import type { SyncParts } from '@/services/sync/parts';
import { createSyncEngine } from '@/services/sync/engine';
import { createAccountProviders } from '@/services/sync/provider';
import { createSyncScheduler } from '@/services/sync/scheduler';
import { createDownloadService } from '@/services/downloads';
import { createListsService } from '@/services/lists';
import { createDownloadSettingsService } from '@/services/downloads/settings';
import { createPlaybackService } from '@/services/playback';
import { createWatchService } from '@/services/watch';
import { createOutboxDrainer } from '@/services/watch/drainer';

import { testCrypto } from './crypto';
import { openTestDatabase, type Engine, type TestDatabaseOptions } from './engines';
import { counterIds, fakeClock, fakeNetwork, memoryCredentialStore, silentLog } from './fakes';
import { fakeActivity, fakeOwnerAuthentication } from './sync';

export { counterIds, fakeClock, fakeNetwork, silentLog } from './fakes';

// sql.js on Node stands in for expo-sqlite and for the browser alike: a backup is the same SQLite file.
const backupSql = createSqlJsBackup(() => initSqlJs());

const unusedFiles: FileExchange = {
  save: async () => {
    throw new Error('This test moves no files.');
  },
  pick: async () => undefined,
};

const unusedHttp: HttpClient = {
  request: async () => {
    throw new Error('These tests talk to fake plugins, never HTTP.');
  },
};

export function movie(connectionId: ConnectionId, id: string, year: number, extra: Partial<Movie> = {}): Movie {
  return {
    type: 'movie',
    key: { connectionId, externalId: id },
    title: id,
    year,
    releaseDate: `${year}-06-01`,
    ratings: {},
    genres: [],
    images: {},
    ...extra,
  };
}

export interface FakeSourceOptions {
  /** Films per call of `connect`, given the connection id it runs for. */
  readonly movies?: (connectionId: ConnectionId) => readonly MediaItem[];
  readonly resume?: (connectionId: ConnectionId) => readonly MediaItem[];
  /** A show's seasons, or a season's episodes. */
  readonly children?: (parent: MediaItem) => readonly MediaItem[];
  /** Thrown by every call while set. */
  readonly failWith?: () => AppError | undefined;
  readonly withImages?: boolean;
  /** Honours `ItemQuery.term`, and declares that it does. */
  readonly searches?: boolean;
  /** Will hand over a copy to keep, and declares that it does. */
  readonly downloads?: boolean;
  /** Reads its credentials before every call, the way a real source signs in. */
  readonly signsIn?: boolean;
  /** A field that says nothing of where or as whom it signs in — as Jellyfin's "local only". */
  readonly withNote?: boolean;
  /** Takes progress and watched state back (`watchStateWrite`), recording each report. */
  readonly writesWatchState?: boolean;
  /** Thrown by the watch-state writes alone while set: the source answers, but takes nothing back. */
  readonly failWritesWith?: () => AppError | undefined;
  /** Says what to play (`playback`), given the request — recorded in `stats.playbackRequests`. */
  readonly playback?: (request: PlaybackRequest) => PlaybackDescriptor;
}

/** A media plugin backed by lists, with the counters a test needs to see what was asked. */
export function fakeMediaPlugin(id: string, options: FakeSourceOptions = {}) {
  const stats = {
    connects: 0,
    calls: 0,
    disposed: 0,
    credentials: [] as Record<string, string>[],
    signedInWith: [] as Record<string, string>[],
    /** Where each sign-in went. */
    signedInAt: [] as string[],
    /** What reached the source, in order: `started 0`, `stopped 90000`, `played true`. */
    reports: [] as string[],
    playbackRequests: [] as PlaybackRequest[],
    downloadRequests: [] as DownloadRequest[],
    /** The term each `listItems` was given — `undefined` where it was asked to browse. */
    terms: [] as (string | undefined)[],
  };
  const manifest: PluginManifest = {
    id: pluginId(`sources/${id}`),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: id,
    description: `The ${id} test source.`,
    media: {
      contentKinds: ['movies', 'shows'],
      capabilities: [
        'browse',
        'watchStateRead',
        ...(options.writesWatchState ? (['watchStateWrite'] as const) : []),
        ...(options.playback ? (['playback'] as const) : []),
        ...(options.withImages ? (['remoteImages', 'offlineMetadata'] as const) : []),
        ...(options.searches ? (['search'] as const) : []),
        ...(options.downloads ? (['downloads'] as const) : []),
      ],
    },
    connectionFields: [
      { key: 'serverUrl', label: 'Server', type: 'url', required: true },
      { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
      { key: 'password', label: 'Password', type: 'password' },
      ...(options.withNote ? [{ key: 'note', label: 'Note', type: 'text' as const }] : []),
    ],
    settings: options.withImages
      ? [{ key: 'cacheMetadata', label: 'Cache', type: 'boolean', default: true, gates: ['media.offlineMetadata'] }]
      : [],
  };
  const plugin: Plugin = {
    manifest,
    media: {
      connect: async (target, context): Promise<ConnectedMediaProvider> => {
        stats.connects += 1;
        const fail = async () => {
          stats.calls += 1;
          if (options.signsIn) {
            stats.signedInWith.push({ ...(await context.credentials.read()) });
            stats.signedInAt.push(String(target.fields.serverUrl));
          }
          const error = options.failWith?.();
          if (error) throw error;
        };
        return {
          connectionId: target.connectionId,
          check: async () => {
            await fail();
            stats.credentials.push({ ...(await context.credentials.read()) });
            return { serverName: String(target.fields.serverUrl), version: 'test' };
          },
          listItems: async (query) => {
            await fail();
            stats.terms.push(query.term);
            const matching = (options.movies?.(target.connectionId) ?? []).filter((item) =>
              query.term === undefined ? true : matchesTerm(query.term, 'title' in item ? item.title : ''),
            );
            const all = matching.toSorted(compareItems(query.sort));
            const offset = query.cursor ? Number(query.cursor) : 0;
            const items = all.slice(offset, offset + query.limit);
            const next = offset + items.length;
            return { items, total: all.length, ...(next < all.length ? { nextCursor: String(next) } : {}) };
          },
          getItem: async (externalId) => {
            await fail();
            const item = (options.movies?.(target.connectionId) ?? []).find((candidate) => candidate.key.externalId === externalId);
            if (!item) throw new AppError('NOT_FOUND', 'No such item.');
            return { item, people: [], studios: [], externalIds: {} };
          },
          getChildren: async (parent) => {
            await fail();
            return { items: options.children?.(parent) ?? [] };
          },
          getResume: async (limit) => {
            await fail();
            return (options.resume?.(target.connectionId) ?? []).slice(0, limit);
          },
          ...(options.withImages
            ? { resolveImage: (ref: string, size: { width: number }) => ({ uri: `https://img.test/${ref}?w=${size.width}` }) }
            : {}),
          ...(options.playback
            ? {
                getPlaybackDescriptor: async (request: PlaybackRequest) => {
                  await fail();
                  stats.playbackRequests.push(request);
                  return options.playback?.(request) as PlaybackDescriptor;
                },
                resolveHeaders: async (ref: string) => (ref === 'stream' ? { Authorization: 'Token t' } : undefined),
              }
            : {}),
          ...(options.downloads
            ? {
                getDownloadDescriptor: async (request: DownloadRequest) => {
                  await fail();
                  stats.downloadRequests.push(request);
                  return {
                    key: request.key,
                    uri: 'https://home/file.mkv',
                    container: 'mkv',
                    transcoded: false,
                    expectedBytes: 1_000,
                    subtitles: [],
                  };
                },
              }
            : {}),
          ...(options.writesWatchState
            ? {
                reportPlayback: async (report: ProgressReport) => {
                  await fail();
                  const refused = options.failWritesWith?.();
                  if (refused) throw refused;
                  stats.reports.push(`${report.key.externalId} ${report.kind} ${report.positionMs}`);
                },
                setPlayed: async (key: GlobalMediaKey, played: boolean) => {
                  await fail();
                  const refused = options.failWritesWith?.();
                  if (refused) throw refused;
                  stats.reports.push(`${key.externalId} played ${played}`);
                },
              }
            : {}),
          dispose: async () => {
            stats.disposed += 1;
          },
        };
      },
    },
  };
  return { plugin, manifest, stats };
}

export function buildServices(options: {
  plugins: readonly Plugin[];
  /** The platform the catalogue picks plugins for; a phone unless a test says otherwise. */
  platform?: PlatformId;
  network?: ReturnType<typeof fakeNetwork>;
  engine?: Engine;
  /** The same database again, for a test that restarts. */
  where?: Pick<TestDatabaseOptions, 'path' | 'indexedDB'>;
  clock?: ReturnType<typeof fakeClock>;
  credentials?: ReturnType<typeof memoryCredentialStore>;
  deviceBound?: ReturnType<typeof memoryCredentialStore>;
  /** Names the device: its ids and its device key. Two devices in one test need two names. */
  device?: string;
  owner?: ReturnType<typeof fakeOwnerAuthentication>;
  /** The share sheet and the document picker, as a test plays them. */
  files?: FileExchange;
  /** How long backup targets wait after a change before saving. */
  backupDebounceMs?: number;
  /** Players with an engine, as the composition root lists them. */
  players?: readonly PlayerPlugin[];
}) {
  const device = options.device ?? 'device';
  const clock = options.clock ?? fakeClock();
  const db = openTestDatabase(options.engine ?? 'sqlite', { clock, ...options.where });
  const credentials = options.credentials ?? memoryCredentialStore();
  const deviceBound = options.deviceBound ?? memoryCredentialStore();
  const ids = counterIds(`${device}-`);
  const network = options.network ?? fakeNetwork();
  const sessions = createSessions(deviceBound);
  const janitor = createSecretJanitor({ db, stores: [credentials, deviceBound], log: silentLog });
  const catalog = createPluginCatalog(options.plugins, { platform: options.platform ?? 'ios', strict: true, warn: () => undefined });
  const identity = { identity: async () => ({ appName: 'Test', appVersion: '1', deviceName: 'Test', deviceKey: `${device}-key` }) };
  const crypto = testCrypto();
  const accountProviders = createAccountProviders({ http: unusedHttp, network, identity, clock, crypto, catalog, credentials, sessions });
  const ownerAuthentication = options.owner ?? fakeOwnerAuthentication({ available: false });
  const parts: SyncParts = { db, credentials, catalog, ids, janitor, log: silentLog };
  const lock = createInProcessLock();
  const engine = createSyncEngine({ parts, providers: accountProviders, lock, clock });
  const owner = createOwnerCheck({
    account: accountOwnerCheck({ db, catalog, providers: accountProviders, status: engine.status }),
    device: ownerAuthentication,
    log: silentLog,
  });
  const pins = createPinService({ db, credentials, janitor, ids, clock, owner });
  const session = createSessionService({ users: db.users, deviceSettings: db.deviceSettings, account: db.account, pins });
  const sources = createSourceService({ catalog, connections: db.connections });
  const pool = createProviderPool({ catalog, credentials, sessions, http: unusedHttp, network, identity, clock, crypto, log: silentLog });
  const connections = createConnectionService({
    db,
    credentials,
    catalog,
    janitor,
    ids,
    onChanged: (id) => pool.forgetConnection(id),
  });
  const activity = fakeActivity();
  const drainer = createOutboxDrainer({ outbox: db.outbox, sources, pool, network, activity, clock, log: silentLog, afterQueueMs: 0 });
  const watch = createWatchService({ db, sources, clock, onQueued: () => drainer.kick() });
  const media = createMediaService({
    sources,
    pool,
    probeSecrets: connections.probeSecrets,
    network,
    cache: db.mediaCache,
    watch,
    clock,
    log: silentLog,
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
    http: unusedHttp,
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
    log: silentLog,
    debounceMs: options.backupDebounceMs ?? 0,
  });
  engine.onApplied((applied) => {
    for (const id of applied.connections) pool.forgetConnection(id);
    for (const id of applied.removedProfiles) media.forgetUser(id);
    void session.refresh();
  });
  const players = createPlayerService({ catalog, deviceSettings: db.deviceSettings, platform: options.platform ?? 'ios' });
  const appSettings = createAppSettingsService({ deviceSettings: db.deviceSettings });
  // A file store entirely in memory: a test can say a film is kept without a disk.
  const files = fakeFileStore();
  const downloadSettings = createDownloadSettingsService({ deviceSettings: db.deviceSettings });
  const downloads = createDownloadService({
    downloads: db.downloads,
    files,
    sources,
    pool,
    limitBytes: async () => (await downloadSettings.get()).maxBytes,
    ids,
    clock,
    log: silentLog,
    onQueued: () => undefined,
  });
  const lists = createListsService({ db, ids, clock });
  const playback = createPlaybackService({
    players: options.players ?? [],
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
  const orientation = { turns: [] as string[], upright: async () => void orientation.turns.push('upright'), free: async () => void orientation.turns.push('free') };
  return {
    db,
    credentials,
    deviceBound,
    janitor,
    network,
    clock,
    engine,
    scheduler,
    activity,
    ownerAuthentication,
    parts,
    lock,
    drainer,
    pool,
    orientation,
    fileStore: files,
    services: {
      catalog,
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
      backup,
      backupTargets,
      files: options.files ?? unusedFiles,
      players,
      appSettings,
      watch,
      downloads,
      downloadSettings,
      lists,
      playback,
      orientation,
    },
  };
}

/**
 * A file store with no disk behind it: what a test writes is what it reads.
 * `fetch` is what a test overrides to make a download finish, fail or stall.
 */
export function fakeFileStore(): FileStore & { readonly kept: Map<string, number>; limit: number } {
  const kept = new Map<string, number>();
  const store = {
    kept,
    limit: 64 * 1024 * 1024 * 1024,
    available: true,
    fetch: async ({ fileName }: TransferRequest) => {
      kept.set(fileName, 1_000);
      return { bytesDone: 1_000, bytesTotal: 1_000 };
    },
    used: async () => [...kept.values()].reduce((total, size) => total + size, 0),
    free: async () => store.limit,
    remove: async (fileName: string) => void kept.delete(fileName),
    sweep: async (keep: ReadonlySet<string>) => {
      for (const name of [...kept.keys()]) if (!keep.has(name)) kept.delete(name);
    },
    uriOf: (fileName: string) => `file:///downloads/${fileName}`,
  };
  return store;
}

/** A player plugin with a fake engine: every controller it made, and the context each got. */
export function fakePlayerPlugin(name: string, profiles: Partial<Record<PlatformId, PlayerProfile>>) {
  const made: { readonly context: PlayerContext; readonly player: MediaPlayer; readonly loads: unknown[]; disposed: boolean }[] = [];
  const plugin: PlayerPlugin = {
    manifest: {
      id: pluginId(`players/${name}`),
      category: 'players',
      platforms: ['ios', 'android', 'web'],
      displayName: name,
      description: `The ${name} test player.`,
      player: { profiles },
      connectionFields: [],
      settings: [],
    },
    player: {
      create: (context) => {
        const loads: unknown[] = [];
        const entry = {
          context,
          loads,
          disposed: false,
          player: {
            load: async (request: unknown) => {
              loads.push(request);
            },
            play: () => undefined,
            pause: () => undefined,
            seek: () => undefined,
            setAudioTrack: () => undefined,
            setSubtitleTrack: () => undefined,
            subscribe: () => () => undefined,
            dispose: async () => {
              entry.disposed = true;
            },
          } satisfies MediaPlayer,
        };
        made.push(entry);
        return entry.player;
      },
    },
    View: () => null,
  };
  return { plugin, made };
}
