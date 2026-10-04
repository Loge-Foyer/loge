import type { ContentKind } from './content';
import type { MediaItem } from './media';

export const ITEM_SORTS = ['releaseDate', 'addedAt', 'title', 'rating'] as const;

export type ItemSortKey = (typeof ITEM_SORTS)[number];

export type SortOrder = 'asc' | 'desc';

/**
 * What a search may be narrowed to, where the source can narrow it
 * (`media.searchScopes`): everything it holds, or only the things to watch, the
 * channels or the playlists.
 */
export const SEARCH_SCOPES = ['all', 'video', 'channel', 'playlist'] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number];

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
  /**
   * Only what matches these words, within this kind — never across kinds, so a
   * search of films answers with films. Set only on a source whose `search` is
   * in effect; one without it never sees a term. Matching is the source's own:
   * a server searches as it searches, and a provider that holds its catalogue
   * on the device matches titles, case and accents aside.
   */
  readonly term?: string;
  /**
   * What the search answers with, where the source lists the scope in
   * `media.searchScopes` — set only with a term. Absent: what the kind holds,
   * as a search always did.
   */
  readonly scope?: SearchScope;
  /**
   * Only what the source files under this genre, within this kind — one genre,
   * the way `genreKey` matches one: case, accents and spacing aside. Set only
   * on a source whose `genres` is in effect; with a term, only where `search`
   * is too.
   */
  readonly genre?: string;
}

/** Which genres: those a source files titles of one kind under. */
export interface GenreQuery {
  readonly kind: ContentKind;
}

/** Which of an item's children: one of its sections, and the page after `cursor`. */
export interface ChildQuery {
  /** One of `MediaDetail.sections`. Absent: the item's only list, or its first section. */
  readonly section?: string;
  /** The previous page's `nextCursor`. */
  readonly cursor?: string;
}

/**
 * Case and accents folded away, for matching on the device. A server searches
 * however it searches; this is only for a source that holds its catalogue
 * here — a portal's channel list, say — so that "Das Erste" is found by
 * "erste" and "Pokémon" by "pokemon".
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * One genre across sources: case, accents and spacing aside, so "Science
 * Fiction" from one server and "science  fiction" from another are one row,
 * and a source filtering on the device matches as the app merges.
 */
export function genreKey(name: string): string {
  return fold(name).trim().replace(/\s+/g, ' ');
}

/**
 * Whether every word of `term` appears somewhere in `texts`. Words rather than
 * the whole phrase, so "erste das" finds "Das Erste", and a blank term matches
 * everything — a search box that has been emptied is not a filter.
 */
export function matchesTerm(term: string, ...texts: readonly (string | undefined)[]): boolean {
  const words = fold(term).split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return true;
  const haystack = fold(texts.filter((text): text is string => text !== undefined).join(' '));
  return words.every((word) => haystack.includes(word));
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
