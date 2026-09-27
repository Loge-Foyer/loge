// The service graph as the composition root builds it, with only the device
// boundary faked: ids, clock, network, identity, the keychain and the HTTP
// client. Every service is the real one, on the real database engine.
import {
  AppError,
  compareItems,
  pluginId,
  type ConnectedMediaProvider,
  type HttpClient,
  type MediaItem,
  type Movie,
  type Plugin,
  type PluginManifest,
  type ConnectionId,
} from '@sc/api';

import { createConnectionService } from '@/services/connections';
import { createDevicePlugins } from '@/services/device-plugins';
import { createHomeLayoutService } from '@/services/home-layout';
import { createMediaService } from '@/services/media';
import { createProviderPool } from '@/services/media/pool';
import { createPinService } from '@/services/pins';
import { createPluginCatalog } from '@/services/plugin-catalog';
import { createProfileService } from '@/services/profiles';
import { createSecretJanitor } from '@/services/secrets';
import { createSessionService } from '@/services/session';
import { createSessions } from '@/services/sessions';
import { createSourceService } from '@/services/sources';

import { openTestDatabase, type Engine, type TestDatabaseOptions } from './engines';
import { counterIds, fakeClock, fakeNetwork, memoryCredentialStore, silentLog } from './fakes';

export { counterIds, fakeClock, fakeNetwork, silentLog } from './fakes';

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
  /** Reads its credentials before every call, the way a real source signs in. */
  readonly signsIn?: boolean;
}

/** A media plugin backed by lists, with the counters a test needs to see what was asked. */
export function fakeMediaPlugin(id: string, options: FakeSourceOptions = {}) {
  const stats = { connects: 0, calls: 0, disposed: 0, credentials: [] as Record<string, string>[], signedInWith: [] as Record<string, string>[] };
  const manifest: PluginManifest = {
    id: pluginId(id),
    displayName: id,
    description: `The ${id} test source.`,
    media: {
      contentKinds: ['movies', 'shows'],
      capabilities: ['browse', 'watchStateRead', ...(options.withImages ? (['remoteImages', 'offlineMetadata'] as const) : [])],
    },
    connectionFields: [
      { key: 'serverUrl', label: 'Server', type: 'url', required: true },
      { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
      { key: 'password', label: 'Password', type: 'password' },
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
          if (options.signsIn) stats.signedInWith.push({ ...(await context.credentials.read()) });
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
            const all = (options.movies?.(target.connectionId) ?? []).toSorted(compareItems(query.sort));
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
  network?: ReturnType<typeof fakeNetwork>;
  engine?: Engine;
  /** The same database again, for a test that restarts. */
  where?: Pick<TestDatabaseOptions, 'path' | 'indexedDB'>;
  clock?: ReturnType<typeof fakeClock>;
  credentials?: ReturnType<typeof memoryCredentialStore>;
  deviceBound?: ReturnType<typeof memoryCredentialStore>;
}) {
  const clock = options.clock ?? fakeClock();
  const db = openTestDatabase(options.engine ?? 'sqlite', { clock, ...options.where });
  const credentials = options.credentials ?? memoryCredentialStore();
  const deviceBound = options.deviceBound ?? memoryCredentialStore();
  const ids = counterIds();
  const network = options.network ?? fakeNetwork();
  const sessions = createSessions(deviceBound);
  const janitor = createSecretJanitor({ db, stores: [credentials, deviceBound], log: silentLog });
  const catalog = createPluginCatalog(options.plugins, { strict: true, warn: () => undefined });
  const devicePlugins = createDevicePlugins(db.deviceSettings);
  const pins = createPinService({ db, credentials, janitor, ids, clock });
  const session = createSessionService({ users: db.users, deviceSettings: db.deviceSettings, pins });
  const sources = createSourceService({ catalog, devicePlugins, connections: db.connections });
  const pool = createProviderPool({
    catalog,
    credentials,
    sessions,
    http: unusedHttp,
    network,
    identity: { identity: async () => ({ appName: 'Test', appVersion: '1', deviceName: 'Test', deviceKey: 'device-1' }) },
    clock,
    log: silentLog,
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
    log: silentLog,
  });
  const profiles = createProfileService({ db, janitor, session, ids, onRemoved: (id) => media.forgetUser(id) });
  const homeLayout = createHomeLayoutService(db.preferences);
  return {
    db,
    credentials,
    deviceBound,
    janitor,
    network,
    clock,
    services: { catalog, devicePlugins, session, profiles, pins, connections, sources, homeLayout, media },
  };
}
