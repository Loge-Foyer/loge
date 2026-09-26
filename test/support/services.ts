// The service graph as the composition root builds it, with only the device
// boundary faked: ids, clock, network, identity and the HTTP client. Every
// service and repository is the real one.
import {
  AppError,
  compareItems,
  pluginId,
  type ConnectedMediaProvider,
  type HttpClient,
  type MediaItem,
  type Movie,
  type NetworkKind,
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
import type { Clock, Logger, NetworkMonitor } from '@/services/ports';
import { createProfileService } from '@/services/profiles';
import { createSessionService } from '@/services/session';
import { createSessions } from '@/services/sessions';
import { createSourceService } from '@/services/sources';
import { createMemoryStores } from '@/persistence/memory';
import { createMemoryCredentialStore } from '@/platform/credential-store';

export function counterIds() {
  let next = 0;
  return { next: () => `id-${(next += 1)}` };
}

export function fakeClock(start = 1_000_000): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

export function fakeNetwork(initial: NetworkKind = 'wifi'): NetworkMonitor & { set(kind: NetworkKind): void } {
  let current = initial;
  const listeners = new Set<(kind: NetworkKind, previous: NetworkKind) => void>();
  return {
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (kind) => {
      if (kind === current) return;
      const previous = current;
      current = kind;
      for (const listener of listeners) listener(kind, previous);
    },
  };
}

export const silentLog: Logger = { debug: () => undefined, warn: () => undefined, error: () => undefined };

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
  /** Thrown by every call while set. */
  readonly failWith?: () => AppError | undefined;
  readonly withImages?: boolean;
}

/** A media plugin backed by lists, with the counters a test needs to see what was asked. */
export function fakeMediaPlugin(id: string, options: FakeSourceOptions = {}) {
  const stats = { connects: 0, calls: 0, disposed: 0, credentials: [] as Record<string, string>[] };
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
        const fail = () => {
          stats.calls += 1;
          const error = options.failWith?.();
          if (error) throw error;
        };
        return {
          connectionId: target.connectionId,
          check: async () => {
            fail();
            stats.credentials.push({ ...(await context.credentials.read()) });
            return { serverName: String(target.fields.serverUrl), version: 'test' };
          },
          listItems: async (query) => {
            fail();
            const all = (options.movies?.(target.connectionId) ?? []).toSorted(compareItems(query.sort));
            const offset = query.cursor ? Number(query.cursor) : 0;
            const items = all.slice(offset, offset + query.limit);
            const next = offset + items.length;
            return { items, total: all.length, ...(next < all.length ? { nextCursor: String(next) } : {}) };
          },
          getItem: async (externalId) => {
            fail();
            const item = (options.movies?.(target.connectionId) ?? []).find((candidate) => candidate.key.externalId === externalId);
            if (!item) throw new AppError('NOT_FOUND', 'No such item.');
            return { item, people: [], studios: [], externalIds: {} };
          },
          getChildren: async () => ({ items: [] }),
          getResume: async (limit) => {
            fail();
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

export function buildServices(options: { plugins: readonly Plugin[]; network?: ReturnType<typeof fakeNetwork> }) {
  const stores = createMemoryStores();
  const credentials = createMemoryCredentialStore();
  const ids = counterIds();
  const clock = fakeClock();
  const network = options.network ?? fakeNetwork();
  const sessions = createSessions(credentials);
  const catalog = createPluginCatalog(options.plugins, { strict: true, warn: () => undefined });
  const devicePlugins = createDevicePlugins(stores.deviceSettings);
  const pins = createPinService({ users: stores.users, credentials, ids, clock });
  const session = createSessionService({ users: stores.users, deviceSettings: stores.deviceSettings, pins });
  const sources = createSourceService({ catalog, devicePlugins, connections: stores.connections });
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
    connections: stores.connections,
    users: stores.users,
    credentials,
    catalog,
    sessions,
    ids,
    onChanged: (id) => pool.forgetConnection(id),
  });
  const media = createMediaService({ sources, pool, probeSecrets: connections.probeSecrets, network, log: silentLog });
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
  return {
    stores,
    credentials,
    network,
    clock,
    services: { catalog, devicePlugins, session, profiles, pins, connections, sources, homeLayout, media },
  };
}
