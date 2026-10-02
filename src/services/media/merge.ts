import { compareItems, mergeSorted, type ConnectionId, type ItemSort, type MediaItem } from '@loge/api';

/** Several sources' lists, each already in `sort` order, as one list in that order. */
export function mergeRows(lists: readonly (readonly MediaItem[])[], sort: ItemSort, limit: number): readonly MediaItem[] {
  return mergeSorted(lists, compareItems(sort), limit).map((entry) => entry.value);
}

/** Most recently played first — how every source orders what is in progress. */
export function byLastPlayed(a: MediaItem, b: MediaItem): number {
  const time = (item: MediaItem) => Date.parse(item.watch?.lastPlayedAt ?? '') || 0;
  return time(b) - time(a) || (a.key.externalId < b.key.externalId ? -1 : a.key.externalId > b.key.externalId ? 1 : 0);
}

/** Where one source stands in a merged grid: its cursor, and what it sent but the grid has not shown yet. */
export interface SourceCursor {
  readonly connectionId: ConnectionId;
  readonly cursor?: string;
  readonly buffer: readonly MediaItem[];
  readonly state: 'open' | 'done' | 'failed';
  readonly total?: number;
}

/** The page parameter of a merged grid. Plain data, as the query cache keeps it. */
export interface MergeState {
  readonly sources: readonly SourceCursor[];
}

/**
 * Takes items across the buffered sources in order. It stops as soon as a
 * source that may still have more has nothing buffered: its next item could
 * come first, so nothing after this point can be shown yet.
 */
export function takeMerged(
  cursors: readonly SourceCursor[],
  sort: ItemSort,
  limit: number,
): { readonly items: readonly MediaItem[]; readonly cursors: readonly SourceCursor[] } {
  const compare = compareItems(sort);
  const buffers = cursors.map((cursor) => [...cursor.buffer]);
  const items: MediaItem[] = [];
  while (items.length < limit) {
    if (cursors.some((cursor, index) => cursor.state === 'open' && (buffers[index]?.length ?? 0) === 0)) break;
    let best: MediaItem[] | undefined;
    for (const buffer of buffers) {
      const head = buffer[0];
      const bestHead = best?.[0];
      if (head && (!bestHead || compare(head, bestHead) < 0)) best = buffer;
    }
    const next = best?.shift();
    if (!next) break;
    items.push(next);
  }
  return { items, cursors: cursors.map((cursor, index) => ({ ...cursor, buffer: buffers[index] ?? [] })) };
}

export function isExhausted(cursors: readonly SourceCursor[]): boolean {
  return cursors.every((cursor) => cursor.state !== 'open' && cursor.buffer.length === 0);
}
