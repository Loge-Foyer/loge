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
import type { Clock, Logger, MediaCacheRepository, NetworkMonitor, SavedList } from '../ports';
import type { Source, SourceService } from '../sources';
import { showsOn } from '../tab-content';
import { isAborted, sourceError, toAppError, type SourceError } from './errors';
import { byLastPlayed, isExhausted, mergeRows, takeMerged, type MergeState, type SourceCursor } from './merge';
import { fingerprintOf, type ProviderPool } from './pool';

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

/** A detail page, and — when the source could not answer — why, next to what was saved from it. */
export interface ItemResult {
  readonly detail: MediaDetail;
  readonly sourceError?: SourceError;
}

export interface ChildrenResult {
  readonly items: readonly MediaItem[];
  readonly sourceError?: SourceError;
}

/**
 * What sources answered last time, read without asking them — for a screen to
 * show while it waits. `null` when nothing was saved.
 */
export interface SavedMedia {
  row(userId: UserId, spec: RowSpec, limit: number): Promise<RowResult | null>;
  continueWatching(userId: UserId, limit?: number): Promise<RowResult | null>;
  /** The first page only, with no `next`: a saved page is shown, never paged from. */
  gridFirstPage(userId: UserId, spec: RowSpec, pageSize: number): Promise<GridPage | null>;
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
  item(userId: UserId, key: GlobalMediaKey, signal?: CancelSignal): Promise<ItemResult>;
  children(userId: UserId, parent: MediaItem, signal?: CancelSignal): Promise<ChildrenResult>;
  readonly saved: SavedMedia;
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
  /** Deletes saved details and episode lists nobody has opened for a while. */
  prune(): Promise<void>;
  forgetConnection(id: ConnectionId): void;
  forgetUser(id: UserId): void;
}

const CONTINUE_LIMIT = 10;
// A source that sends empty pages yet claims more is taken at its word only so often.
const REFILLS_PER_PAGE = 2;
// Rows, the grid's first page and Continue Watching are replaced on every
// refresh; what accumulates is what was opened once — details and episodes.
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const CHILDREN = 'children:';

const listKey = {
  row: (spec: RowSpec) => `row:${spec.kind}:${spec.sort.by}:${spec.sort.order}`,
  grid: (spec: RowSpec) => `grid:${spec.kind}:${spec.sort.by}:${spec.sort.order}`,
  resume: 'resume',
  children: (parent: MediaItem) => `${CHILDREN}${parent.key.externalId}`,
};

// Gone or no longer possible: what was saved for it is wrong now, not merely old.
const invalidates = (error: AppError) => error.code === 'NOT_FOUND' || error.code === 'INVALID_STATE';

export function createMediaService(deps: {
  sources: SourceService;
  pool: ProviderPool;
  probeSecrets: ConnectionService['probeSecrets'];
  network: NetworkMonitor;
  cache: MediaCacheRepository;
  clock: Clock;
  log: Logger;
}): MediaService {
  const { sources, pool, probeSecrets, network, cache, clock, log } = deps;
  const listeners = new Set<() => void>();
  // The sources each profile last used, for work that cannot wait on a lookup.
  const live = new Map<UserId, ReadonlyMap<ConnectionId, Source>>();
  // Sources whose saved answers were purged this session, because they may not be kept.
  const purged = new Set<string>();

  network.subscribe((_kind, previous) => {
    // The first reading after launch is not a change of network.
    if (previous === 'unknown') return;
    pool.unparkAll();
    for (const listener of listeners) listener();
  });

  const can = (source: Source, capability: MediaCapability) => source.effective.media?.capabilities.has(capability) ?? false;

  /** Whether this profile may keep what the source answers: the plugin allows it, and the switch for it is on. */
  const keeps = (source: Source) => can(source, 'offlineMetadata');

  const quietly = <T>(work: Promise<T>): Promise<T | undefined> =>
    work.catch((error: unknown) => {
      log.debug('storage', 'Saved media could not be read or written', { error: String(error) });
      return undefined;
    });

  const sourcesOf = async (userId: UserId) => {
    const found = await sources.forUser(userId);
    live.set(userId, new Map(found.map((source) => [source.connection.id, source])));
    for (const source of found) {
      if (keeps(source)) continue;
      // Switched off since, perhaps by a write that raced the switch: what was kept goes.
      const mark = `${userId}|${source.connection.id}|${fingerprintOf(source)}`;
      if (purged.has(mark)) continue;
      purged.add(mark);
      await quietly(cache.purge(source.connection.id, userId));
    }
    return found;
  };

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

  const saveList = async (userId: UserId, source: Source, key: string, items: readonly MediaItem[]) => {
    if (keeps(source)) await quietly(cache.putList(userId, source.connection.id, key, fingerprintOf(source), { items, savedAt: clock.now() }));
  };

  /** What stands in for a source that could not answer, if it may be kept and was. */
  const savedFor = async (userId: UserId, source: Source, key: string, failure: AppError): Promise<SavedList | undefined> => {
    if (!keeps(source)) return undefined;
    if (invalidates(failure)) {
      await quietly(cache.removeList(userId, source.connection.id, key));
      return undefined;
    }
    return quietly(cache.list(userId, source.connection.id, key, fingerprintOf(source)));
  };

  /**
   * Every source at once, each one's list saved as it arrives. A source that
   * fails becomes a `SourceError` beside what did arrive — with what was saved
   * from it standing in, when there is something.
   */
  const fanOut = async (
    userId: UserId,
    list: readonly Source[],
    key: string,
    fetch: (provider: ConnectedMediaProvider) => Promise<readonly MediaItem[]>,
  ) => {
    const results = await Promise.all(
      list.map(async (source): Promise<{ items?: readonly MediaItem[]; error?: SourceError }> => {
        try {
          const items = await call(source, fetch);
          await saveList(userId, source, key, items);
          return { items };
        } catch (error) {
          if (isAborted(error)) throw error;
          const failure = toAppError(error, log);
          const saved = await savedFor(userId, source, key, failure);
          return saved ? { items: saved.items, error: sourceError(source, failure, saved.savedAt) } : { error: sourceError(source, failure) };
        }
      }),
    );
    return {
      lists: results.flatMap((result) => (result.items ? [result.items] : [])),
      sourceErrors: results.flatMap((result) => (result.error ? [result.error] : [])),
    };
  };

  /** The library's sources: what Media and Videos show. IPTV keeps to TV. */
  const libraryOf = async (userId: UserId) =>
    (await sourcesOf(userId)).filter((source) => {
      const kinds = source.effective.media?.contentKinds ?? [];
      return showsOn('media', source.manifest.category, kinds) || showsOn('videos', source.manifest.category, kinds);
    });

  const listing = async (userId: UserId, kind: ContentKind) =>
    (await libraryOf(userId)).filter((source) => can(source, 'browse') && (source.effective.media?.contentKinds.includes(kind) ?? false));

  const listItems = (provider: ConnectedMediaProvider, query: ItemQuery, signal?: CancelSignal): Promise<ItemPage> => {
    if (!provider.listItems) throw missing('listItems');
    return provider.listItems(query, signal);
  };

  const sourceFor = async (userId: UserId, connectionId: ConnectionId) => {
    const source = (await sourcesOf(userId)).find((candidate) => candidate.connection.id === connectionId);
    if (!source) throw new AppError('NOT_FOUND', 'This source is not available to this profile.', { retry: 'never' });
    return source;
  };

  /**
   * What was saved for each source that may be kept. Its provider is connected
   * too — no I/O — so the saved items' artwork resolves on the first render:
   * nothing would tell a card to try again once the provider connected.
   */
  const savedLists = async (userId: UserId, list: readonly Source[], key: string) => {
    const found = await Promise.all(
      list.filter(keeps).map(async (source) => {
        const saved = await quietly(cache.list(userId, source.connection.id, key, fingerprintOf(source)));
        if (saved && can(source, 'remoteImages')) await pool.provider(source).catch(() => undefined);
        return saved ? { source, saved } : undefined;
      }),
    );
    return found.filter((entry) => entry !== undefined);
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

  const saved: SavedMedia = {
    row: async (userId, spec, limit) => {
      const found = await savedLists(userId, await listing(userId, spec.kind), listKey.row(spec));
      if (found.length === 0) return null;
      return { items: mergeRows(found.map(({ saved: list }) => list.items), spec.sort, limit), sourceErrors: [] };
    },
    continueWatching: async (userId, limit = CONTINUE_LIMIT) => {
      const list = (await libraryOf(userId)).filter((source) => can(source, 'watchStateRead'));
      const found = await savedLists(userId, list, listKey.resume);
      if (found.length === 0) return null;
      const lists = found.map(({ saved: entry }) => [...entry.items].sort(byLastPlayed));
      return { items: mergeSorted(lists, byLastPlayed, limit).map((entry) => entry.value), sourceErrors: [] };
    },
    gridFirstPage: async (userId, spec, pageSize) => {
      const found = await savedLists(userId, await listing(userId, spec.kind), listKey.grid(spec));
      if (found.length === 0) return null;
      const cursors: SourceCursor[] = found.map(({ source, saved: list }) => ({
        connectionId: source.connection.id,
        buffer: list.items,
        state: 'done',
      }));
      return { items: takeMerged(cursors, spec.sort, pageSize).items, sourceErrors: [] };
    },
  };

  return {
    row: async (userId, spec, limit, signal) => {
      const { lists, sourceErrors } = await fanOut(userId, await listing(userId, spec.kind), listKey.row(spec), async (provider) =>
        (await listItems(provider, { kind: spec.kind, sort: spec.sort, limit }, signal)).items,
      );
      return { items: mergeRows(lists, spec.sort, limit), sourceErrors };
    },

    continueWatching: async (userId, limit = CONTINUE_LIMIT, signal) => {
      const list = (await libraryOf(userId)).filter((source) => can(source, 'watchStateRead'));
      const { lists, sourceErrors } = await fanOut(userId, list, listKey.resume, (provider) => {
        if (!provider.getResume) throw missing('getResume');
        return provider.getResume(limit, signal);
      });
      // A few items per source: cheap to put in order here rather than trust every plugin to.
      const ordered = lists.map((items) => [...items].sort(byLastPlayed));
      return { items: mergeSorted(ordered, byLastPlayed, limit).map((entry) => entry.value), sourceErrors };
    },

    gridPage: async (userId, spec, state, pageSize, signal) => {
      const list = await listing(userId, spec.kind);
      const byId = new Map(list.map((source) => [source.connection.id, source]));
      const key = listKey.grid(spec);
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
              // A source's own first page is what is saved for it — never a later one.
              if (state === null && attempt === 0) await saveList(userId, source, key, page.items);
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
              const failure = toAppError(error, log);
              // On the first page only, what was saved stands in — as a failed
              // source with no cursor, so the merge neither waits for it nor
              // pages it: a saved page is shown, never paged from.
              const stand = state === null && attempt === 0 ? await savedFor(userId, source, key, failure) : undefined;
              sourceErrors.push(sourceError(source, failure, stand?.savedAt));
              next = stand
                ? { connectionId: cursor.connectionId, buffer: stand.items, state: 'failed' }
                : { ...next, state: 'failed' };
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
      try {
        const detail = await call(source, (provider) => {
          if (!provider.getItem) throw missing('getItem');
          return provider.getItem(key.externalId, signal);
        });
        if (keeps(source)) await quietly(cache.putDetail(userId, fingerprintOf(source), { detail, savedAt: clock.now() }));
        return { detail };
      } catch (error) {
        if (isAborted(error) || !keeps(source)) throw error;
        const failure = toAppError(error, log);
        if (invalidates(failure)) {
          await quietly(cache.removeDetail(userId, key));
          throw failure;
        }
        const stand = await quietly(cache.detail(userId, key, fingerprintOf(source)));
        if (!stand) throw failure;
        return { detail: stand.detail, sourceError: sourceError(source, failure, stand.savedAt) };
      }
    },

    children: async (userId, parent, signal) => {
      const source = await sourceFor(userId, parent.key.connectionId);
      const key = listKey.children(parent);
      try {
        const page = await call(source, (provider) => {
          if (!provider.getChildren) throw missing('getChildren');
          return provider.getChildren(parent, signal);
        });
        await saveList(userId, source, key, page.items);
        return { items: page.items };
      } catch (error) {
        if (isAborted(error)) throw error;
        const failure = toAppError(error, log);
        const stand = await savedFor(userId, source, key, failure);
        if (!stand) throw failure;
        return { items: stand.items, sourceError: sourceError(source, failure, stand.savedAt) };
      }
    },

    saved,

    artwork: (userId, connectionId, ref, size) => {
      const source = live.get(userId)?.get(connectionId);
      if (!source || !can(source, 'remoteImages')) return null;
      const image = pool.connected(source)?.resolveImage?.(ref, size);
      if (!image) return null;
      return { ...image, cachePolicy: keeps(source) ? 'memory-disk' : 'memory' };
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

    prune: async () => {
      await quietly(cache.prune(clock.now() - PRUNE_AFTER_MS, CHILDREN));
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
