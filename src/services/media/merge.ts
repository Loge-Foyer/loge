import { compareItems, genreKey, mergeSorted, type ConnectionId, type ContentKind, type ItemSort, type MediaItem } from '@loge/api';

/**
 * Several lists, each already in `sort` order, as one list in that order —
 * each item once, though a source may list one under two kinds.
 */
export function mergeRows(lists: readonly (readonly MediaItem[])[], sort: ItemSort, limit: number): readonly MediaItem[] {
  const seen = new Set<string>();
  const merged: MediaItem[] = [];
  for (const { value } of mergeSorted(lists, compareItems(sort))) {
    if (merged.length >= limit) break;
    const key = `${value.key.connectionId}|${value.key.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}

/**
 * Every source's genres as one list: each once — `genreKey` alike — spelled as
 * the first source to name it spells it, in `genreKey`'s code-point order, the
 * same on every engine.
 */
export function mergeGenres(lists: readonly (readonly string[])[]): readonly string[] {
  const byKey = new Map<string, string>();
  for (const name of lists.flat()) {
    const trimmed = name.trim();
    if (trimmed !== '' && !byKey.has(genreKey(trimmed))) byKey.set(genreKey(trimmed), trimmed);
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, name]) => name);
}

/** Most recently played first — how every source orders what is in progress. */
export function byLastPlayed(a: MediaItem, b: MediaItem): number {
  const time = (item: MediaItem) => Date.parse(item.watch?.lastPlayedAt ?? '') || 0;
  return time(b) - time(a) || (a.key.externalId < b.key.externalId ? -1 : a.key.externalId > b.key.externalId ? 1 : 0);
}

/** Where one source stands in a merged grid, for one kind: its cursor, and what it sent but the grid has not shown yet. */
export interface SourceCursor {
  readonly connectionId: ConnectionId;
  readonly kind: ContentKind;
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
