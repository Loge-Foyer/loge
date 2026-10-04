import {
  showIdentityOf,
  watchIdentity,
  type ConnectionId,
  type GlobalMediaKey,
  type MediaCapability,
  type MediaItem,
  type PlaybackReport,
  type ProgressReport,
  type UserId,
  type WatchStatus,
} from '@loge/api';

import { stableJson } from '../hash';
import type { IdentityService } from '../identity';
import type { Clock, LocalDatabase, Repositories, WatchEntry, WatchProgress } from '../ports';
import type { Source, SourceService } from '../sources';
import { kindsForTab } from '../tab-content';
import { itemKeyOf } from './item-key';
import { keptRowId } from './kept';
import { toSnapshot } from './snapshot';

// A stop this near the end counts as watched here, as most servers count it;
// the source's own rule wins once it has heard.
const WATCHED_AT = 0.9;
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
// A series someone is watching: an episode of it touched this recently, and the series not marked done.
const WATCHING_FOR_MS = 30 * 24 * 60 * 60 * 1000;
// What the app keeps is journaled, and an account on your server syncs soon
// after each change: while something plays, a minute's progress at a time is
// kept — a pause, a stop and a mark always are.
const KEEP_EVERY_MS = 60_000;

export interface WatchChange {
  readonly userId: UserId;
  readonly key: GlobalMediaKey;
}

/** What the Live tab lists first: something begun on one provider, with how far along. */
export interface InProgress {
  /** A film as it was played, or — for a series — the series, as its latest episode knew it. */
  readonly item: MediaItem;
  /** "S2 · E5" for a series: where it got to. */
  readonly episode?: { readonly seasonNumber?: number; readonly episodeNumber?: number };
}

/**
 * Watch status, whoever keeps it.
 *
 * - **A source that masters it** (`watchStateWrite`): what this device changed
 *   lands in the cache and the outbox together, then returns — in airplane
 *   mode too — and the drainer tells the source later. Until the source has
 *   heard, this device's state is what screens show; after that the source
 *   wins again.
 * - **The app**, for a source that keeps none, on a tab the account keeps it
 *   on (`Source.watch`): one journaled row per profile and thing watched,
 *   keyed by what it is apart from any source (`watchIdentity`) — carried to
 *   your own server by the sync engine, merged field by field there (spec §10).
 *
 * Never both: a source that keeps its own keeps it.
 */
export interface WatchService {
  /** The items, with this profile's own state laid over the source's wherever something still waits for the source. */
  overlay<T extends MediaItem>(userId: UserId, items: readonly T[]): Promise<readonly T[]>;
  /** In progress on this device and not yet heard by the source, the most recent first — for Continue Watching. */
  waiting(userId: UserId): Promise<readonly MediaItem[]>;
  /** Where playback got to. A source that cannot keep it is not told — nothing is queued. */
  report(userId: UserId, item: MediaItem, report: ProgressReport): Promise<void>;
  /** Watched, or not, as the user said. */
  setPlayed(userId: UserId, item: MediaItem, played: boolean): Promise<void>;
  /** Told of a stop or a watched state: what screens show has changed. Progress along the way is not news. */
  subscribe(listener: (change: WatchChange) => void): () => void;
  /** Forgets what this device changed long ago and the source has long since heard. */
  prune(): Promise<void>;
  /**
   * The watch state the app keeps for these items, by `itemKeyOf` — for the
   * ones whose source it keeps it for. Laid over a list where it is drawn: it
   * is local state, so a mark shows at once and no source is asked again.
   */
  keptStatus(userId: UserId, items: readonly MediaItem[]): Promise<ReadonlyMap<string, WatchStatus>>;
  /** What this profile has begun on one provider and not finished, newest first: films, or series. */
  keptInProgress(userId: UserId, connectionId: ConnectionId, type: 'movie' | 'show'): Promise<readonly InProgress[]>;
}

export function createWatchService(deps: {
  readonly db: LocalDatabase;
  readonly sources: SourceService;
  readonly clock: Clock;
  /** The catalogue ids this device found items to have: laid on before an item is keyed, so every copy of a film is one. */
  readonly identities: Pick<IdentityService, 'withKnownIds'>;
  /** Something was queued: deliver soon. */
  readonly onQueued: () => void;
}): WatchService {
  const { db, sources, clock } = deps;
  const listeners = new Set<(change: WatchChange) => void>();

  const can = (source: Source, capability: MediaCapability) => source.effective.media?.capabilities.has(capability) ?? false;
  const sourceOf = async (userId: UserId, key: GlobalMediaKey) =>
    (await sources.forUser(userId)).find((source) => source.connection.id === key.connectionId);

  const tell = (userId: UserId, report: PlaybackReport, key: GlobalMediaKey) => {
    if (report.kind === 'stopped' || report.kind === 'played') {
      for (const listener of [...listeners]) listener({ userId, key });
    }
  };

  /** What the app keeps it under: the catalogue first, the title where a provider keeps copies apart by language. */
  const identityOf = (source: Source, item: MediaItem) => watchIdentity(item, { byTitle: source.manifest.category === 'iptv' });

  /** The app's own: one journaled write, and nothing waits on any source — what a catalogue said of it was found before. */
  const keep = async (userId: UserId, source: Source, played: MediaItem, report: PlaybackReport) => {
    const [item = played] = await deps.identities.withKnownIds(userId, [played]);
    const identity = identityOf(source, item);
    const id = keptRowId(userId, identity);
    const at = now();
    let changed = false;
    await db.transaction(async (tx) => {
      const current = await tx.watchProgress.get(id);
      const moved = current?.positionMs === undefined || report.kind !== 'progress' ? Number.POSITIVE_INFINITY : Math.abs(report.positionMs - current.positionMs);
      if (report.kind === 'progress' && !report.paused && moved < KEEP_EVERY_MS) return;
      const next = progressAfter(current, report, { id, userId, identity, item, at });
      if (current && sameProgress(current, next)) return;
      await tx.watchProgress.put({ ...next, version: (current?.version ?? 0) + 1 });
      // A series marked unwatched starts again: its episodes with it.
      if (report.kind === 'played' && !report.played && item.type === 'show') await restartEpisodes(tx, userId, identity, at);
      changed = true;
    });
    if (changed) tell(userId, report, played.key);
  };

  const record = async (userId: UserId, item: MediaItem, report: PlaybackReport, next: (current: WatchStatus) => WatchStatus) => {
    const source = await sourceOf(userId, item.key);
    if (source?.watch === 'app') return keep(userId, source, item, report);
    if (!source || !can(source, 'watchStateWrite')) return;
    const current = (await db.watchStatus.get(userId, item.key))?.status ?? item.watch ?? { played: false };
    const status = next(current);
    const entry: WatchEntry = {
      key: item.key,
      status,
      // Its title and artwork, for Continue Watching while the source is away — only where they may be kept.
      ...(can(source, 'offlineMetadata') ? { item: { ...item, watch: status } } : {}),
      updatedAt: clock.now(),
    };
    await db.transaction(async (tx) => {
      await tx.watchStatus.put(userId, entry);
      await tx.outbox.add(userId, report);
    });
    deps.onQueued();
    tell(userId, report, item.key);
  };

  const now = () => new Date(clock.now()).toISOString();

  return {
    overlay: async (userId, items) => {
      if (items.length === 0) return items;
      const pending = await db.outbox.pendingKeys(userId);
      if (pending.size === 0) return items;
      return Promise.all(
        items.map(async (item) => {
          if (!pending.has(itemKeyOf(item.key))) return item;
          const entry = await db.watchStatus.get(userId, item.key);
          return entry ? { ...item, watch: entry.status } : item;
        }),
      );
    },

    waiting: async (userId) => {
      const pending = await db.outbox.pendingKeys(userId);
      const told =
        pending.size === 0
          ? []
          : (await db.watchStatus.list(userId)).flatMap((entry) =>
              entry.item && pending.has(itemKeyOf(entry.key)) && inProgress(entry.status) ? [{ ...entry.item, watch: entry.status }] : [],
            );
      // And what the app keeps for the library's sources that keep none: begun, not finished.
      const library = new Set(
        (await sources.forUser(userId))
          .filter((source) => source.watch === 'app' && kindsForTab('media', source.manifest.category, source.effective.media?.contentKinds ?? []).length > 0)
          .map((source) => source.connection.id),
      );
      if (library.size === 0) return told;
      const kept = (await db.watchProgress.list(userId)).flatMap((progress) => {
        const status = statusOf(progress);
        return progress.item && library.has(progress.item.key.connectionId) && inProgress(status) ? [{ ...progress.item, watch: status }] : [];
      });
      return [...told, ...kept];
    },

    report: (userId, item, report) =>
      record(userId, item, report, (current) => {
        const at = now();
        if (report.kind !== 'stopped') return { ...current, positionMs: report.positionMs, lastPlayedAt: at };
        const runtime = item.runtimeMs;
        if (runtime && report.positionMs >= runtime * WATCHED_AT) {
          const { positionMs: _position, progress: _progress, ...rest } = current;
          return { ...rest, played: true, lastPlayedAt: at };
        }
        return {
          ...current,
          played: false,
          positionMs: report.positionMs,
          ...(runtime ? { progress: Math.min(1, report.positionMs / runtime) } : {}),
          lastPlayedAt: at,
        };
      }),

    setPlayed: (userId, item, played) =>
      record(userId, item, { kind: 'played', key: item.key, played }, (current) => {
        const { positionMs: _position, progress: _progress, lastPlayedAt, ...rest } = current;
        return { ...rest, played, ...(played ? { lastPlayedAt: now() } : lastPlayedAt ? { lastPlayedAt } : {}) };
      }),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    prune: () => db.watchStatus.prune(clock.now() - PRUNE_AFTER_MS),

    keptStatus: async (userId, items) => {
      const kept = new Map<string, WatchStatus>();
      if (items.length === 0) return kept;
      const byConnection = new Map((await sources.forUser(userId)).filter((source) => source.watch === 'app').map((source) => [source.connection.id, source]));
      if (byConnection.size === 0) return kept;
      // Each item's row — and, for an episode, its show's: a series marked done marks every episode of it.
      const wanted = new Map<string, { readonly item: MediaItem; readonly own: string; readonly show?: string }>();
      for (const item of await deps.identities.withKnownIds(userId, items)) {
        const source = byConnection.get(item.key.connectionId);
        if (!source) continue;
        const show = item.type === 'episode' ? showIdentityOf(item, { byTitle: source.manifest.category === 'iptv' }) : undefined;
        wanted.set(itemKeyOf(item.key), {
          item,
          own: keptRowId(userId, identityOf(source, item)),
          ...(show === undefined ? {} : { show: keptRowId(userId, show) }),
        });
      }
      const ids = new Set<string>();
      for (const entry of wanted.values()) {
        ids.add(entry.own);
        if (entry.show) ids.add(entry.show);
      }
      const rows = new Map((await db.watchProgress.getMany([...ids])).map((row) => [row.id, row]));
      for (const [key, entry] of wanted) {
        const own = rows.get(entry.own);
        const show = entry.show === undefined ? undefined : rows.get(entry.show);
        if (own) kept.set(key, statusOf(own, show));
        else if (show?.watched) kept.set(key, { played: true, ...(show.updatedAt ? { lastPlayedAt: show.updatedAt } : {}) });
      }
      return kept;
    },

    keptInProgress: async (userId, connectionId, type) => {
      const rows = await db.watchProgress.list(userId);
      if (type === 'movie') {
        return rows.flatMap((row) =>
          row.item?.type === 'movie' && row.item.key.connectionId === connectionId && !row.watched && (row.positionMs ?? 0) > 0
            ? [{ item: { ...row.item, watch: statusOf(row) } }]
            : [],
        );
      }
      // A series is being watched while an episode of it was touched lately and it is not marked done.
      const finished = new Set(rows.filter((row) => row.item?.type === 'show' && row.watched).map((row) => row.identity));
      const since = clock.now() - WATCHING_FOR_MS;
      const seen = new Set<string>();
      const shows: InProgress[] = [];
      for (const row of rows) {
        const episode = row.item;
        if (episode?.type !== 'episode' || episode.key.connectionId !== connectionId || Date.parse(row.updatedAt) < since) continue;
        const show = row.identity.includes('/') ? row.identity.slice(0, row.identity.lastIndexOf('/')) : undefined;
        const series = itemKeyOf(episode.show);
        if (seen.has(series) || (show !== undefined && finished.has(show))) continue;
        seen.add(series);
        shows.push({
          item: {
            type: 'show',
            key: episode.show,
            title: episode.showTitle,
            ...(episode.showYear === undefined ? {} : { year: episode.showYear }),
            ...(episode.showExternalIds ? { externalIds: episode.showExternalIds } : {}),
            ratings: {},
            genres: [],
            images: episode.images.poster ? { poster: episode.images.poster } : {},
          },
          episode: {
            ...(episode.seasonNumber === undefined ? {} : { seasonNumber: episode.seasonNumber }),
            ...(episode.episodeNumber === undefined ? {} : { episodeNumber: episode.episodeNumber }),
          },
        });
      }
      return shows;
    },
  };
}

/** A kept row as screens read watch state: where it got to, and how far along. */
function statusOf(row: WatchProgress, show?: WatchProgress): WatchStatus {
  const played = row.watched || show?.watched === true;
  const progress = !played && row.positionMs !== undefined && row.durationMs ? Math.min(1, row.positionMs / row.durationMs) : undefined;
  return {
    played,
    ...(played || row.positionMs === undefined ? {} : { positionMs: row.positionMs }),
    ...(progress === undefined ? {} : { progress }),
    lastPlayedAt: row.updatedAt,
  };
}

const sameProgress = (a: WatchProgress, b: WatchProgress) => stableJson({ ...a, version: 0, updatedAt: '' }) === stableJson({ ...b, version: 0, updatedAt: '' });

/**
 * One report applied to what the app keeps. Watched holds, once reached, until
 * someone says otherwise; "mark as unwatched" is a new round, which wins over
 * anything another device knew of the last (spec §10). A report at nought
 * never lowers where it got to — an engine that closes says 0 more often than
 * someone rewinds to the very start.
 */
export function progressAfter(
  current: WatchProgress | undefined,
  report: PlaybackReport,
  at: { readonly id: string; readonly userId: UserId; readonly identity: string; readonly item: MediaItem; readonly at: string },
): WatchProgress {
  const base: WatchProgress = current ?? {
    id: at.id,
    userId: at.userId,
    identity: at.identity,
    round: 0,
    watched: false,
    createdAt: at.at,
    updatedAt: at.at,
    version: 0,
  };
  const known = { ...base.externalIds, ...at.item.externalIds };
  const common = {
    ...base,
    ...(Object.keys(known).length === 0 ? {} : { externalIds: known }),
    item: toSnapshot(at.item),
    updatedAt: at.at,
  };
  const { positionMs: _position, ...cleared } = common;
  if (report.kind === 'played') {
    return report.played ? { ...cleared, watched: true } : { ...cleared, round: base.round + 1, watched: false };
  }
  const duration = report.durationMs ?? base.durationMs ?? at.item.runtimeMs;
  const position = report.positionMs > 0 ? report.positionMs : base.positionMs;
  const done = report.kind === 'stopped' && duration !== undefined && position !== undefined && position >= duration * WATCHED_AT;
  return {
    ...common,
    ...(position === undefined ? {} : { positionMs: position }),
    ...(duration === undefined ? {} : { durationMs: duration }),
    watched: base.watched || done,
  };
}

/** A series begun again: every episode of it this profile kept goes to a new round, unwatched. */
async function restartEpisodes(tx: Repositories, userId: UserId, show: string, at: string): Promise<void> {
  for (const row of await tx.watchProgress.list(userId)) {
    if (!row.identity.startsWith(`${show}/`)) continue;
    const { positionMs: _position, ...rest } = row;
    await tx.watchProgress.put({ ...rest, round: row.round + 1, watched: false, updatedAt: at, version: row.version + 1 });
  }
}

/** Begun and not finished. Some sources give a position, some only how far along. */
export function inProgress(status: WatchStatus | undefined): boolean {
  return status !== undefined && !status.played && ((status.positionMs ?? 0) > 0 || (status.progress ?? 0) > 0);
}
