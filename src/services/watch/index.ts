import type { GlobalMediaKey, MediaCapability, MediaItem, PlaybackReport, ProgressReport, UserId, WatchStatus } from '@sc/api';

import type { Clock, LocalDatabase, WatchEntry } from '../ports';
import type { Source, SourceService } from '../sources';
import { itemKeyOf } from './item-key';

// A stop this near the end counts as watched here, as most servers count it;
// the source's own rule wins once it has heard.
const WATCHED_AT = 0.9;
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface WatchChange {
  readonly userId: UserId;
  readonly key: GlobalMediaKey;
}

/**
 * Watch status for sources that master it (`watchStateWrite`): what this
 * device changed lands in the cache and the outbox together, then returns —
 * in airplane mode too — and the drainer tells the source later. Until the
 * source has heard, this device's state is what screens show; after that the
 * source wins again.
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
}

export function createWatchService(deps: {
  readonly db: LocalDatabase;
  readonly sources: SourceService;
  readonly clock: Clock;
  /** Something was queued: deliver soon. */
  readonly onQueued: () => void;
}): WatchService {
  const { db, sources, clock } = deps;
  const listeners = new Set<(change: WatchChange) => void>();

  const can = (source: Source, capability: MediaCapability) => source.effective.media?.capabilities.has(capability) ?? false;
  const sourceOf = async (userId: UserId, key: GlobalMediaKey) =>
    (await sources.forUser(userId)).find((source) => source.connection.id === key.connectionId);

  const record = async (userId: UserId, item: MediaItem, report: PlaybackReport, next: (current: WatchStatus) => WatchStatus) => {
    const source = await sourceOf(userId, item.key);
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
    if (report.kind === 'stopped' || report.kind === 'played') {
      for (const listener of [...listeners]) listener({ userId, key: item.key });
    }
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
      if (pending.size === 0) return [];
      return (await db.watchStatus.list(userId)).flatMap((entry) =>
        entry.item && pending.has(itemKeyOf(entry.key)) && inProgress(entry.status) ? [{ ...entry.item, watch: entry.status }] : [],
      );
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
  };
}

/** Begun and not finished. Some sources give a position, some only how far along. */
export function inProgress(status: WatchStatus | undefined): boolean {
  return status !== undefined && !status.played && ((status.positionMs ?? 0) > 0 || (status.progress ?? 0) > 0);
}
