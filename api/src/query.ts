import type { ContentKind } from './content';
import type { MediaItem } from './media';

export const ITEM_SORTS = ['releaseDate', 'addedAt', 'title', 'rating'] as const;

export type ItemSortKey = (typeof ITEM_SORTS)[number];

export type SortOrder = 'asc' | 'desc';

export interface ItemSort {
  readonly by: ItemSortKey;
  readonly order: SortOrder;
}

/** One page of a source's catalogue: one kind, in one order. */
export interface ItemQuery {
  readonly kind: ContentKind;
  readonly sort: ItemSort;
  readonly limit: number;
  /** The previous page's `nextCursor`. Only the plugin that made it can read it. */
  readonly cursor?: string;
}

export interface ItemPage {
  readonly items: readonly MediaItem[];
  /** Absent on the last page. */
  readonly nextCursor?: string;
  readonly total?: number;
}

/**
 * The order every source's pages follow, so the app can merge sources and a
 * plugin can merge its own libraries. It mirrors Jellyfin: a missing release
 * date falls back to January 1 of the year, and a missing value sorts as the
 * smallest — first ascending, last descending. Ties break on title, then id,
 * so the order is total.
 */
export function compareItems(sort: ItemSort): (a: MediaItem, b: MediaItem) => number {
  const direction = sort.order === 'asc' ? 1 : -1;
  return (a, b) => {
    if (sort.by === 'title') {
      return direction * compareText(titleOf(a), titleOf(b)) || compareText(a.key.externalId, b.key.externalId);
    }
    return (
      direction * compareMissingFirst(valueOf(sort.by, a), valueOf(sort.by, b)) ||
      compareText(titleOf(a), titleOf(b)) ||
      compareText(a.key.externalId, b.key.externalId)
    );
  };
}

/**
 * Merges lists that are each already in `compare` order into one list in that
 * order, remembering which list every value came from.
 */
export function mergeSorted<T>(
  lists: readonly (readonly T[])[],
  compare: (a: T, b: T) => number,
  limit = Number.POSITIVE_INFINITY,
): readonly { readonly value: T; readonly list: number }[] {
  const positions = lists.map(() => 0);
  const merged: { value: T; list: number }[] = [];
  while (merged.length < limit) {
    let best = -1;
    let bestValue: T | undefined;
    lists.forEach((list, index) => {
      const candidate = list[positions[index] ?? 0];
      if (candidate === undefined) return;
      if (bestValue === undefined || compare(candidate, bestValue) < 0) {
        best = index;
        bestValue = candidate;
      }
    });
    if (bestValue === undefined) break;
    merged.push({ value: bestValue, list: best });
    positions[best] = (positions[best] ?? 0) + 1;
  }
  return merged;
}

function valueOf(by: Exclude<ItemSort['by'], 'title'>, item: MediaItem): number | undefined {
  switch (by) {
    case 'releaseDate':
      return timeOf(item.releaseDate) ?? (item.year === undefined ? undefined : Date.UTC(item.year, 0, 1));
    case 'addedAt':
      return timeOf(item.addedAt);
    case 'rating':
      return item.ratings.community;
  }
}

function timeOf(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? undefined : time;
}

function titleOf(item: MediaItem): string {
  return (item.sortTitle ?? item.title).toLowerCase();
}

function compareMissingFirst(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a < b ? -1 : 1;
}

// Code-point order rather than localeCompare: the same answer on every engine.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
