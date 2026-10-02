import {
  AppError,
  type CancelSignal,
  type ChannelGroup,
  type ChannelPage,
  type ChannelQuery,
  type ConnectedMediaProvider,
  type ConnectionId,
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
  type PlaybackDescriptor,
  type PlaybackRequest,
  type PluginId,
  type Programme,
  type SourceInfo,
  type UserId,
} from '@sc/api';

import type { ConnectionService, SecretScope, ValuesDraft } from '../connections';
import type { Clock, DownloadRepository, Logger, MediaCacheRepository, NetworkMonitor, SavedList } from '../ports';
import type { Source, SourceService } from '../sources';
import { showsOn } from '../tab-content';
import { inProgress, type WatchService } from '../watch';
import { itemKeyOf } from '../watch/item-key';
import { isAborted, sourceError, toAppError, type SourceError } from './errors';
import { byLastPlayed, isExhausted, mergeRows, takeMerged, type MergeState, type SourceCursor } from './merge';
import { fingerprintOf, type ProviderPool } from './pool';

export type { SourceError } from './errors';
export type { MergeState } from './merge';

export interface RowSpec {
  readonly kind: ContentKind;
  readonly sort: ItemSort;
  /**
   * One source only, for a tab that shows one at a time. Absent means every
   * source that brings the kind, merged — which is what Media wants and Videos
   * does not.
   */
  readonly connectionId?: ConnectionId;
  /**
   * Only what matches, within this kind. Asked of the sources whose `search`
   * is in effect, and of no other — a source that cannot search is left out
   * rather than answered for. A searched page is never saved: what is kept for
   * a kind is its catalogue, not somebody's query.
   */
  readonly term?: string;
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

/** What one source answered for live TV — or, when it could not, what was saved from it and why. */
export interface LiveResult<T> {
  readonly value: T;
  readonly sourceError?: SourceError;
}

/** One source's own page of one kind, in its own order — the TV tab's films and series. */
export interface SourcePage extends ItemPage {
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
  /**
   * What to play, for the engine the request describes. Its addresses can
   * carry credentials: it is held in memory only — never saved, never logged —
   * and asked for again each time something plays.
   */
  playbackDescriptor(userId: UserId, request: PlaybackRequest, signal?: CancelSignal): Promise<PlaybackDescriptor>;
  /** A source's channel groups. */
  channelGroups(userId: UserId, connectionId: ConnectionId, signal?: CancelSignal): Promise<LiveResult<readonly ChannelGroup[]>>;
  /** A page of a source's channels, in its own order. */
  channels(userId: UserId, connectionId: ConnectionId, query: ChannelQuery, signal?: CancelSignal): Promise<LiveResult<ChannelPage>>;
  /** What the channels air in a window. Kept per channel and day, where the source may be kept. */
  guide(userId: UserId, connectionId: ConnectionId, channels: readonly GlobalMediaKey[], from: string, to: string, signal?: CancelSignal): Promise<LiveResult<readonly Programme[]>>;
  /** One source's page of one kind, in the source's own order: nothing is merged with another source. */
  sourcePage(userId: UserId, connectionId: ConnectionId, query: ItemQuery, signal?: CancelSignal): Promise<SourcePage>;
  readonly saved: SavedMedia;
  /**
   * Synchronous: an image address needs no network, only a connected source.
   * The same object for the same address, however often it is asked: the web
   * image component fetches again for a new one.
   */
  artwork(userId: UserId, connectionId: ConnectionId, ref: ImageRef, size: ImageSize): ResolvedArtwork | null;
  /**
   * Moves when a connection's images may resolve differently: its provider
   * connected, or answered, or was let go. A card that drew its plate before
   * any of that asks `artwork` again when this moves.
   */
  artworkGeneration(connectionId: ConnectionId): number;
  subscribeArtwork(listener: () => void): () => void;
  /** Connects the source behind an image that cannot resolve yet — no network — and moves its generation once it has. */
  prepareArtwork(userId: UserId, connectionId: ConnectionId): void;
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
const GUIDE_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

const GUIDE = 'guide:';
/** A grid scoped to one source keeps its own saved pages, apart from the merged ones. */
const scope = (spec: RowSpec) => (spec.connectionId === undefined ? '' : `:@${spec.connectionId}`);
const listKey = {
  row: (spec: RowSpec) => `row:${spec.kind}:${spec.sort.by}:${spec.sort.order}${scope(spec)}`,
  grid: (spec: RowSpec) => `grid:${spec.kind}:${spec.sort.by}:${spec.sort.order}${scope(spec)}`,
  resume: 'resume',
  children: (parent: MediaItem) => `${CHILDREN}${parent.key.externalId}`,
  source: (query: ItemQuery) => `source:${query.kind}:${query.sort.by}:${query.sort.order}`,
  groups: 'live:groups',
  channels: (groupId: string | undefined) => `live:channels:${groupId ?? '*'}`,
  // One channel's day, in UTC: what the guide keeps, merged as windows of it arrive.
  guide: (channel: GlobalMediaKey, day: string) => `${GUIDE}${channel.externalId}:${day}`,
};

const dayOf = (iso: string) => iso.slice(0, 10);
const daysBetween = (from: string, to: string): readonly string[] => {
  const days: string[] = [];
  for (let at = Date.parse(`${dayOf(from)}T00:00:00Z`); at < Date.parse(to); at += 86_400_000) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
};

const searches = (term: string | undefined) => (term ?? '').trim() !== '';

// Gone or no longer possible: what was saved for it is wrong now, not merely old.
const invalidates = (error: AppError) => error.code === 'NOT_FOUND' || error.code === 'INVALID_STATE';

export function createMediaService(deps: {
  sources: SourceService;
  pool: ProviderPool;
  probeSecrets: ConnectionService['probeSecrets'];
  network: NetworkMonitor;
  cache: MediaCacheRepository;
  /** This device's watch state, laid over what sources answer until they have heard it. */
  watch: Pick<WatchService, 'overlay' | 'waiting'>;
  /** What this device keeps: a kept copy's page opens with no network at all. */
  kept: Pick<DownloadRepository, 'forItem'>;
  clock: Clock;
  log: Logger;
}): MediaService {
  const { sources, pool, probeSecrets, network, cache, watch, kept, clock, log } = deps;
  const listeners = new Set<() => void>();
  // The sources each profile last used, for work that cannot wait on a lookup.
  const live = new Map<UserId, ReadonlyMap<ConnectionId, Source>>();
  // Sources whose saved answers were purged this session, because they may not be kept.
  const purged = new Set<string>();
  const generations = new Map<ConnectionId, number>();
  const artworkListeners = new Set<() => void>();
  const resolved = new Map<string, ResolvedArtwork>();
  const preparing = new Set<string>();
  const moved = (connectionId: ConnectionId) => {
    generations.set(connectionId, (generations.get(connectionId) ?? 0) + 1);
    for (const listener of artworkListeners) listener();
  };

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

  /**
   * Calls a source, parking it when trying again cannot help until something
   * changes. Connecting, and every answer, may change what its images resolve
   * to — a provider can learn an image's address from what it lists — so both
   * move the connection's artwork on.
   */
  const call = async <T>(source: Source, run: (provider: ConnectedMediaProvider) => Promise<T>): Promise<T> => {
    const parked = pool.parked(source);
    if (parked) throw parked;
    try {
      const connected = pool.connected(source) !== undefined;
      const provider = await pool.provider(source);
      if (!connected) moved(source.connection.id);
      const value = await run(provider);
      moved(source.connection.id);
      return value;
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

  const listing = async (userId: UserId, spec: Pick<RowSpec, 'kind' | 'connectionId'>, searching = false) =>
    (await libraryOf(userId)).filter(
      (source) =>
        can(source, 'browse') &&
        (source.effective.media?.contentKinds.includes(spec.kind) ?? false) &&
        // A term goes only to a source that promised to honour one.
        (!searching || can(source, 'search')) &&
        (spec.connectionId === undefined || source.connection.id === spec.connectionId),
    );

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

  /**
   * Continue Watching: the sources' resume lists with this device's state laid
   * over them — marked watched here, gone from it — and what was watched here
   * that a source has not heard of yet.
   */
  const resumeRow = async (userId: UserId, lists: readonly (readonly MediaItem[])[], from: readonly Source[], limit: number) => {
    const listed = await watch.overlay(userId, lists.flat());
    const known = new Set(listed.map((item) => itemKeyOf(item.key)));
    const connections = new Set(from.map((source) => source.connection.id));
    const added = (await watch.waiting(userId)).filter((item) => connections.has(item.key.connectionId) && !known.has(itemKeyOf(item.key)));
    return [...listed, ...added]
      .filter((item) => inProgress(item.watch))
      .sort(byLastPlayed)
      .slice(0, limit);
  };

  /**
   * A live-TV call to one source, saved where the source may be kept — and
   * when it cannot answer, what was saved from it, with why beside it.
   */
  const liveCall = async <T>(
    userId: UserId,
    connectionId: ConnectionId,
    capability: MediaCapability,
    key: string | undefined,
    run: (provider: ConnectedMediaProvider) => Promise<T>,
  ): Promise<LiveResult<T>> => {
    const source = await sourceFor(userId, connectionId);
    if (!can(source, capability)) throw new AppError('INVALID_STATE', 'This source brings no live TV.', { retry: 'never' });
    try {
      const value = await call(source, run);
      if (key && keeps(source)) await quietly(cache.putValue(userId, connectionId, key, fingerprintOf(source), { value, savedAt: clock.now() }));
      return { value };
    } catch (error) {
      if (isAborted(error) || !key || !keeps(source)) throw error;
      const failure = toAppError(error, log);
      const saved = await quietly(cache.value<T>(userId, connectionId, key, fingerprintOf(source)));
      if (!saved) throw failure;
      return { value: saved.value, sourceError: sourceError(source, failure, saved.savedAt) };
    }
  };

  /** Each channel's day, merged with what was kept of it: the guide arrives a window at a time. */
  const saveGuide = async (userId: UserId, source: Source, channels: readonly GlobalMediaKey[], programmes: readonly Programme[]) => {
    const print = fingerprintOf(source);
    for (const channel of channels) {
      const own = programmes.filter((programme) => programme.channel.externalId === channel.externalId);
      for (const day of new Set(own.map((programme) => dayOf(programme.startsAt)))) {
        const key = listKey.guide(channel, day);
        const kept = (await cache.value<readonly Programme[]>(userId, source.connection.id, key, print))?.value ?? [];
        const fresh = own.filter((programme) => dayOf(programme.startsAt) === day);
        const starts = new Set(fresh.map((programme) => programme.startsAt));
        const merged = [...kept.filter((programme) => !starts.has(programme.startsAt)), ...fresh].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
        await cache.putValue(userId, source.connection.id, key, print, { value: merged, savedAt: clock.now() });
      }
    }
  };

  const savedGuide = async (userId: UserId, source: Source, channels: readonly GlobalMediaKey[], from: string, to: string) => {
    const print = fingerprintOf(source);
    const found: Programme[] = [];
    let savedAt: number | undefined;
    for (const channel of channels) {
      for (const day of daysBetween(from, to)) {
        const saved = await cache.value<readonly Programme[]>(userId, source.connection.id, listKey.guide(channel, day), print);
        if (!saved) continue;
        found.push(...saved.value);
        savedAt = Math.min(savedAt ?? saved.savedAt, saved.savedAt);
      }
    }
    return savedAt === undefined ? undefined : { value: found, savedAt };
  };

  const withWatch = async (userId: UserId, detail: MediaDetail): Promise<MediaDetail> => {
    const [item] = await watch.overlay(userId, [detail.item]);
    return item === detail.item || !item ? detail : { ...detail, item };
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
      const found = await savedLists(userId, await listing(userId, spec), listKey.row(spec));
      if (found.length === 0) return null;
      return { items: await watch.overlay(userId, mergeRows(found.map(({ saved: list }) => list.items), spec.sort, limit)), sourceErrors: [] };
    },
    continueWatching: async (userId, limit = CONTINUE_LIMIT) => {
      const list = (await libraryOf(userId)).filter((source) => can(source, 'watchStateRead'));
      const found = await savedLists(userId, list, listKey.resume);
      const items = await resumeRow(userId, found.map(({ saved: entry }) => entry.items), list, limit);
      return found.length === 0 && items.length === 0 ? null : { items, sourceErrors: [] };
    },
    gridFirstPage: async (userId, spec, pageSize) => {
      const found = await savedLists(userId, await listing(userId, spec), listKey.grid(spec));
      if (found.length === 0) return null;
      const cursors: SourceCursor[] = found.map(({ source, saved: list }) => ({
        connectionId: source.connection.id,
        buffer: list.items,
        state: 'done',
      }));
      return { items: await watch.overlay(userId, takeMerged(cursors, spec.sort, pageSize).items), sourceErrors: [] };
    },
  };

  return {
    row: async (userId, spec, limit, signal) => {
      const { lists, sourceErrors } = await fanOut(userId, await listing(userId, spec), listKey.row(spec), async (provider) =>
        (await listItems(provider, { kind: spec.kind, sort: spec.sort, limit }, signal)).items,
      );
      return { items: await watch.overlay(userId, mergeRows(lists, spec.sort, limit)), sourceErrors };
    },

    continueWatching: async (userId, limit = CONTINUE_LIMIT, signal) => {
      const list = (await libraryOf(userId)).filter((source) => can(source, 'watchStateRead'));
      const { lists, sourceErrors } = await fanOut(userId, list, listKey.resume, (provider) => {
        if (!provider.getResume) throw missing('getResume');
        return provider.getResume(limit, signal);
      });
      return { items: await resumeRow(userId, lists, list, limit), sourceErrors };
    },

    gridPage: async (userId, spec, state, pageSize, signal) => {
      const term = spec.term?.trim();
      const searching = term !== undefined && term.length > 0;
      const list = await listing(userId, spec, searching);
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
                listItems(
                  provider,
                  { kind: spec.kind, sort: spec.sort, limit: pageSize, ...(next.cursor ? { cursor: next.cursor } : {}), ...(searching ? { term } : {}) },
                  signal,
                ),
              );
              // A source's own first page is what is saved for it — never a
              // later one, and never a search: a query is not a catalogue.
              if (state === null && attempt === 0 && !searching) await saveList(userId, source, key, page.items);
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
              // Nothing saved stands in for a search: it would answer a
              // question it was never asked.
              const stand = state === null && attempt === 0 && !searching ? await savedFor(userId, source, key, failure) : undefined;
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
        items: await watch.overlay(userId, items),
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
        return { detail: await withWatch(userId, detail) };
      } catch (error) {
        if (isAborted(error)) throw error;
        const failure = toAppError(error, log);
        if (keeps(source)) {
          if (invalidates(failure)) {
            await quietly(cache.removeDetail(userId, key));
          } else {
            const stand = await quietly(cache.detail(userId, key, fingerprintOf(source)));
            if (stand) return { detail: await withWatch(userId, stand.detail), sourceError: sourceError(source, failure, stand.savedAt) };
          }
        }
        // A copy on this device plays with no network, and gone from the
        // source or not, so its page opens from the item as it was kept.
        const copy = await quietly(kept.forItem(userId, key));
        if (copy?.state !== 'done') throw failure;
        return {
          detail: await withWatch(userId, { item: copy.item, people: [], studios: [], externalIds: {} }),
          sourceError: sourceError(source, failure, copy.createdAt),
        };
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
        return { items: await watch.overlay(userId, page.items) };
      } catch (error) {
        if (isAborted(error)) throw error;
        const failure = toAppError(error, log);
        const stand = await savedFor(userId, source, key, failure);
        if (!stand) throw failure;
        return { items: await watch.overlay(userId, stand.items), sourceError: sourceError(source, failure, stand.savedAt) };
      }
    },

    playbackDescriptor: async (userId, request, signal) => {
      const source = await sourceFor(userId, request.key.connectionId);
      if (!can(source, 'playback')) throw new AppError('INVALID_STATE', 'This source has nothing to play.', { retry: 'never' });
      return call(source, (provider) => {
        if (!provider.getPlaybackDescriptor) throw missing('getPlaybackDescriptor');
        return provider.getPlaybackDescriptor(request, signal);
      });
    },

    channelGroups: (userId, connectionId, signal) =>
      liveCall(userId, connectionId, 'channels', listKey.groups, (provider) => {
        if (!provider.listChannelGroups) throw missing('listChannelGroups');
        return provider.listChannelGroups(signal);
      }),

    channels: (userId, connectionId, query, signal) =>
      // Only a group's first page is kept: a saved page is shown, never paged
      // from. Never a search's, which would come back as the group's list.
      liveCall(userId, connectionId, 'channels', query.cursor || searches(query.term) ? undefined : listKey.channels(query.groupId), (provider) => {
        if (!provider.listChannels) throw missing('listChannels');
        return provider.listChannels(query, signal);
      }),

    guide: async (userId, connectionId, channels, from, to, signal) => {
      const source = await sourceFor(userId, connectionId);
      if (!can(source, 'epg')) return { value: [] };
      const inWindow = (programme: Programme) => programme.endsAt > from && programme.startsAt < to;
      try {
        const programmes = await call(source, (provider) => {
          if (!provider.getGuide) throw missing('getGuide');
          return provider.getGuide({ channels, from, to }, signal);
        });
        if (keeps(source)) await quietly(saveGuide(userId, source, channels, programmes));
        return { value: programmes };
      } catch (error) {
        if (isAborted(error) || !keeps(source)) throw error;
        const failure = toAppError(error, log);
        const saved = await quietly(savedGuide(userId, source, channels, from, to));
        if (!saved || saved.value.length === 0) throw failure;
        return { value: saved.value.filter(inWindow), sourceError: sourceError(source, failure, saved.savedAt) };
      }
    },

    sourcePage: async (userId, connectionId, query, signal) => {
      const source = await sourceFor(userId, connectionId);
      const key = listKey.source(query);
      // A search is never saved, and nothing saved stands in for one: the
      // catalogue is not what a search for something in it found.
      const searching = searches(query.term);
      try {
        const page = await call(source, (provider) => listItems(provider, query, signal));
        if (!query.cursor && !searching) await saveList(userId, source, key, page.items);
        return { ...page, items: await watch.overlay(userId, page.items) };
      } catch (error) {
        if (isAborted(error) || query.cursor || searching) throw error;
        const failure = toAppError(error, log);
        const stand = await savedFor(userId, source, key, failure);
        if (!stand) throw failure;
        return { items: await watch.overlay(userId, stand.items), sourceError: sourceError(source, failure, stand.savedAt) };
      }
    },

    saved,

    artwork: (userId, connectionId, ref, size) => {
      const source = live.get(userId)?.get(connectionId);
      if (!source || !can(source, 'remoteImages')) return null;
      const image = pool.connected(source)?.resolveImage?.(ref, size);
      if (!image) return null;
      const next: ResolvedArtwork = { ...image, cachePolicy: keeps(source) ? 'memory-disk' : 'memory' };
      const key = `${userId}|${connectionId}|${ref}|${size.width}x${size.height ?? ''}`;
      const before = resolved.get(key);
      if (before && JSON.stringify(before) === JSON.stringify(next)) return before;
      resolved.set(key, next);
      return next;
    },

    artworkGeneration: (connectionId) => generations.get(connectionId) ?? 0,

    subscribeArtwork: (listener) => {
      artworkListeners.add(listener);
      return () => artworkListeners.delete(listener);
    },

    prepareArtwork: (userId, connectionId) => {
      const known = live.get(userId)?.get(connectionId);
      // Connected already: preparing changes nothing, so the generation must
      // not move — a card whose image cannot resolve would ask for ever.
      if (known && pool.connected(known)) return;
      const mark = `${userId}|${connectionId}`;
      if (preparing.has(mark)) return;
      preparing.add(mark);
      void (async () => {
        try {
          const source = (await sourcesOf(userId)).find((candidate) => candidate.connection.id === connectionId);
          if (!source || !can(source, 'remoteImages') || pool.parked(source)) return;
          await pool.provider(source);
          moved(connectionId);
        } catch {
          // A source that cannot connect keeps its plates; its next answer moves them on.
        } finally {
          preparing.delete(mark);
        }
      })();
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
      // A day's guide is old news in a week.
      await quietly(cache.prune(clock.now() - GUIDE_KEPT_MS, GUIDE));
    },

    forgetConnection: (id) => {
      pool.forgetConnection(id);
      moved(id);
    },

    forgetUser: (id) => {
      const connections = [...(live.get(id)?.keys() ?? [])];
      live.delete(id);
      pool.forgetUser(id);
      for (const connectionId of connections) moved(connectionId);
    },
  };
}

function missing(member: string): AppError {
  return new AppError('INVALID_STATE', `This source claims a capability without ${member}.`, { retry: 'never' });
}
