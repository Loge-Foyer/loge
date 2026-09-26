import {
  AppError,
  mergeSorted,
  type CancelSignal,
  type ConnectedMediaProvider,
  type ConnectionId,
  type ConnectionRoles,
  type ContentKind,
  type FieldValues,
  type GlobalMediaKey,
  type HeadersRef,
  type ImageCrop,
  type ImageRef,
  type ImageSize,
  type ItemPage,
  type ItemQuery,
  type ItemSort,
  type Library,
  type MediaCapability,
  type MediaDetail,
  type MediaItem,
  type PluginId,
  type SourceInfo,
  type UserId,
} from '@sc/api';

import type { ConnectionService, SecretScope, ValuesDraft } from '../connections';
import type { Logger, NetworkMonitor } from '../ports';
import type { Source, SourceService } from '../sources';
import { isAborted, sourceError, toAppError, type SourceError } from './errors';
import { byLastPlayed, isExhausted, mergeRows, takeMerged, type MergeState, type SourceCursor } from './merge';
import type { ProviderPool } from './pool';

export type { SourceError } from './errors';
export type { MergeState } from './merge';

export interface RowSpec {
  readonly kind: ContentKind;
  readonly sort: ItemSort;
}

/** What arrived, and which sources could not answer. Never an error for one source. */
export interface RowResult {
  readonly items: readonly MediaItem[];
  readonly sourceErrors: readonly SourceError[];
}

export interface GridPage extends RowResult {
  readonly total?: number;
  /** Where the next page starts; absent on the last one. */
  readonly next?: MergeState;
}

/** An image, ready for the image component — the only place that ever sees one. */
export interface ResolvedArtwork {
  readonly uri: string;
  readonly headersRef?: HeadersRef;
  readonly blurhash?: string;
  readonly crop?: ImageCrop;
  /** On disk only where the source allows its metadata to be kept. */
  readonly cachePolicy: 'memory' | 'memory-disk';
}

/** A draft of a connection, for trying it before it is saved. */
export interface ProbeTarget {
  readonly pluginId: PluginId;
  readonly connectionId?: ConnectionId;
  readonly roles: ConnectionRoles;
  readonly fields: FieldValues;
  readonly settings: FieldValues;
  readonly scope: SecretScope;
  readonly secrets: ValuesDraft['secrets'];
}

export interface MediaService {
  row(userId: UserId, spec: RowSpec, limit: number, signal?: CancelSignal): Promise<RowResult>;
  continueWatching(userId: UserId, limit?: number, signal?: CancelSignal): Promise<RowResult>;
  gridPage(userId: UserId, spec: RowSpec, state: MergeState | null, pageSize: number, signal?: CancelSignal): Promise<GridPage>;
  item(userId: UserId, key: GlobalMediaKey, signal?: CancelSignal): Promise<MediaDetail>;
  children(userId: UserId, parent: MediaItem, signal?: CancelSignal): Promise<readonly MediaItem[]>;
  /** Synchronous: an image address needs no network, only a connected source. */
  artwork(userId: UserId, connectionId: ConnectionId, ref: ImageRef, size: ImageSize): ResolvedArtwork | null;
  artworkHeaders(userId: UserId, connectionId: ConnectionId, ref: HeadersRef): Promise<Readonly<Record<string, string>> | undefined>;
  /** Signs a draft in, for "Test connection". */
  test(target: ProbeTarget, signal?: CancelSignal): Promise<SourceInfo>;
  libraries(target: ProbeTarget, signal?: CancelSignal): Promise<readonly Library[]>;
  /** Try parked sources again — pull to refresh. */
  unpark(): void;
  /** Called when the network changed and parked sources may answer again. */
  subscribe(listener: () => void): () => void;
  forgetConnection(id: ConnectionId): void;
  forgetUser(id: UserId): void;
}

const CONTINUE_LIMIT = 10;
// A source that sends empty pages yet claims more is taken at its word only so often.
const REFILLS_PER_PAGE = 2;

export function createMediaService(deps: {
  sources: SourceService;
  pool: ProviderPool;
  probeSecrets: ConnectionService['probeSecrets'];
  network: NetworkMonitor;
  log: Logger;
}): MediaService {
  const { sources, pool, probeSecrets, network, log } = deps;
  const listeners = new Set<() => void>();
  // The sources each profile last used, for work that cannot wait on a lookup.
  const live = new Map<UserId, ReadonlyMap<ConnectionId, Source>>();

  network.subscribe((_kind, previous) => {
    // The first reading after launch is not a change of network.
    if (previous === 'unknown') return;
    pool.unparkAll();
    for (const listener of listeners) listener();
  });

  const sourcesOf = async (userId: UserId) => {
    const found = await sources.forUser(userId);
    live.set(userId, new Map(found.map((source) => [source.connection.id, source])));
    return found;
  };

  const can = (source: Source, capability: MediaCapability) => source.effective.media?.capabilities.has(capability) ?? false;

  /** Calls a source, parking it when trying again cannot help until something changes. */
  const call = async <T>(source: Source, run: (provider: ConnectedMediaProvider) => Promise<T>): Promise<T> => {
    const parked = pool.parked(source);
    if (parked) throw parked;
    try {
      return await run(await pool.provider(source));
    } catch (error) {
      if (isAborted(error)) throw error;
      const failure = toAppError(error, log);
      if (failure.retry === 'network-change' || failure.code === 'UNAUTHORIZED') pool.park(source, failure);
      throw failure;
    }
  };

  /** Every source at once; each failure becomes a `SourceError` beside what did arrive. */
  const fanOut = async <T>(list: readonly Source[], run: (provider: ConnectedMediaProvider, source: Source) => Promise<T>) => {
    const results = await Promise.all(
      list.map(async (source) => {
        try {
          return { value: await call(source, (provider) => run(provider, source)) };
        } catch (error) {
          if (isAborted(error)) throw error;
          return { error: sourceError(source, toAppError(error, log)) };
        }
      }),
    );
    return {
      values: results.flatMap((result) => ('value' in result ? [result.value] : [])),
      sourceErrors: results.flatMap((result) => ('error' in result ? [result.error] : [])),
    };
  };

  const listing = async (userId: UserId, kind: ContentKind) =>
    (await sourcesOf(userId)).filter((source) => can(source, 'browse') && (source.effective.media?.contentKinds.includes(kind) ?? false));

  const listItems = (provider: ConnectedMediaProvider, query: ItemQuery, signal?: CancelSignal): Promise<ItemPage> => {
    if (!provider.listItems) throw missing('listItems');
    return provider.listItems(query, signal);
  };

  const sourceFor = async (userId: UserId, connectionId: ConnectionId) => {
    const source = (await sourcesOf(userId)).find((candidate) => candidate.connection.id === connectionId);
    if (!source) throw new AppError('NOT_FOUND', 'This source is not available to this profile.', { retry: 'never' });
    return source;
  };

  const probe = async <T>(target: ProbeTarget, run: (provider: ConnectedMediaProvider) => Promise<T>): Promise<T> => {
    const credentials = await probeSecrets(target.pluginId, target.connectionId, target.scope, target.secrets);
    const provider = await pool.probe({ pluginId: target.pluginId, fields: target.fields, settings: target.settings, credentials });
    try {
      return await run(provider);
    } catch (error) {
      throw isAborted(error) ? error : toAppError(error, log);
    } finally {
      await provider.dispose();
    }
  };

  return {
    row: async (userId, spec, limit, signal) => {
      const { values, sourceErrors } = await fanOut(await listing(userId, spec.kind), (provider) =>
        listItems(provider, { kind: spec.kind, sort: spec.sort, limit }, signal),
      );
      return { items: mergeRows(values.map((page) => page.items), spec.sort, limit), sourceErrors };
    },

    continueWatching: async (userId, limit = CONTINUE_LIMIT, signal) => {
      const list = (await sourcesOf(userId)).filter((source) => can(source, 'watchStateRead'));
      const { values, sourceErrors } = await fanOut(list, (provider) => {
        if (!provider.getResume) throw missing('getResume');
        return provider.getResume(limit, signal);
      });
      // A few items per source: cheap to put in order here rather than trust every plugin to.
      const lists = values.map((list) => [...list].sort(byLastPlayed));
      return { items: mergeSorted(lists, byLastPlayed, limit).map((entry) => entry.value), sourceErrors };
    },

    gridPage: async (userId, spec, state, pageSize, signal) => {
      const list = await listing(userId, spec.kind);
      const byId = new Map(list.map((source) => [source.connection.id, source]));
      // The sources of the first page stay fixed while scrolling; one gone since is dropped.
      const start: readonly SourceCursor[] = state
        ? state.sources.filter((cursor) => byId.has(cursor.connectionId))
        : list.map((source) => ({ connectionId: source.connection.id, buffer: [], state: 'open' as const }));
      const sourceErrors: SourceError[] = [];
      const refilled = await Promise.all(
        start.map(async (cursor) => {
          const source = byId.get(cursor.connectionId);
          let next = cursor;
          for (let attempt = 0; source && next.state === 'open' && next.buffer.length < pageSize && attempt < REFILLS_PER_PAGE; attempt += 1) {
            try {
              const page = await call(source, (provider) =>
                listItems(provider, { kind: spec.kind, sort: spec.sort, limit: pageSize, ...(next.cursor ? { cursor: next.cursor } : {}) }, signal),
              );
              const more = page.nextCursor !== undefined && !(page.items.length === 0 && attempt === REFILLS_PER_PAGE - 1);
              const total = page.total ?? next.total;
              next = {
                connectionId: cursor.connectionId,
                buffer: [...next.buffer, ...page.items],
                state: more ? 'open' : 'done',
                ...(more && page.nextCursor ? { cursor: page.nextCursor } : {}),
                ...(total === undefined ? {} : { total }),
              };
            } catch (error) {
              if (isAborted(error)) throw error;
              sourceErrors.push(sourceError(source, toAppError(error, log)));
              next = { ...next, state: 'failed' };
            }
          }
          return next;
        }),
      );
      const { items, cursors } = takeMerged(refilled, spec.sort, pageSize);
      const totals = cursors.map((cursor) => cursor.total);
      return {
        items,
        sourceErrors,
        ...(isExhausted(cursors) ? {} : { next: { sources: cursors } }),
        ...(totals.every((total) => total !== undefined)
          ? { total: totals.reduce<number>((sum, total) => sum + (total ?? 0), 0) }
          : {}),
      };
    },

    item: async (userId, key, signal) => {
      const source = await sourceFor(userId, key.connectionId);
      return call(source, (provider) => {
        if (!provider.getItem) throw missing('getItem');
        return provider.getItem(key.externalId, signal);
      });
    },

    children: async (userId, parent, signal) => {
      const source = await sourceFor(userId, parent.key.connectionId);
      const page = await call(source, (provider) => {
        if (!provider.getChildren) throw missing('getChildren');
        return provider.getChildren(parent, signal);
      });
      return page.items;
    },

    artwork: (userId, connectionId, ref, size) => {
      const source = live.get(userId)?.get(connectionId);
      if (!source || !can(source, 'remoteImages')) return null;
      const image = pool.connected(source)?.resolveImage?.(ref, size);
      if (!image) return null;
      return { ...image, cachePolicy: can(source, 'offlineMetadata') ? 'memory-disk' : 'memory' };
    },

    artworkHeaders: async (userId, connectionId, ref) => {
      const source = live.get(userId)?.get(connectionId);
      const provider = source ? pool.connected(source) : undefined;
      return provider?.resolveHeaders?.(ref);
    },

    test: (target, signal) => probe(target, (provider) => provider.check(signal)),

    libraries: (target, signal) =>
      probe(target, (provider) => {
        if (!provider.getLibraries) throw missing('getLibraries');
        return provider.getLibraries(signal);
      }),

    unpark: () => pool.unparkAll(),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    forgetConnection: (id) => pool.forgetConnection(id),

    forgetUser: (id) => {
      live.delete(id);
      pool.forgetUser(id);
    },
  };
}

function missing(member: string): AppError {
  return new AppError('INVALID_STATE', `This source claims a capability without ${member}.`, { retry: 'never' });
}

