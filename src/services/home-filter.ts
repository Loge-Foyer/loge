import { genreKey, type ContentKind, type MediaItem } from '@loge/api';

import { NEWEST_RELEASES, titlesAvailable, type HomeFeeds, type HomeRowView, type TitlesRow } from './home-layout';
import type { RowSpec } from './media';
import { TAB_CONTENT } from './tab-content';

/** What the home is narrowed to: a kind, a genre, both, or nothing. The screen's while it is open — never stored. */
export interface HomeFilter {
  readonly kind?: ContentKind;
  readonly genre?: string;
}

/** The filter's own row, which a grid opened from it is known by. */
export const FILTER_ROW_ID = 'filter';

export const isFiltered = (filter: HomeFilter): boolean => filter.kind !== undefined || filter.genre !== undefined;

/**
 * A row narrowed by the filter: its kinds to the filter's, and a row of every
 * genre to the filter's. `undefined` where nothing of it is left — another
 * kind, or another genre, since a query names one.
 */
export function narrowRow(row: TitlesRow, filter: HomeFilter): TitlesRow | undefined {
  const kinds = filter.kind === undefined ? row.kinds : row.kinds.filter((kind) => kind === filter.kind);
  if (kinds.length === 0) return undefined;
  if (filter.genre !== undefined && row.genre !== undefined && genreKey(row.genre) !== genreKey(filter.genre)) return undefined;
  const genre = row.genre ?? filter.genre;
  return { ...row, kinds, ...(genre === undefined ? {} : { genre }) };
}

/** The filter's own row: everything of its kind — or of every kind — in its genre, newest first. */
export function filterRow(filter: HomeFilter): TitlesRow {
  return {
    id: FILTER_ROW_ID,
    type: 'titles',
    kinds: filter.kind === undefined ? TAB_CONTENT.media : [filter.kind],
    ...(filter.genre === undefined ? {} : { genre: filter.genre }),
    sort: NEWEST_RELEASES,
    card: 'poster',
    hidden: false,
    extra: false,
  };
}

/**
 * Whether Continue Watching and Downloaded show under the filter. Their items
 * say their type, but not their kind — anime is shows and films — and an
 * episode rarely says its genres, so only a filter of films or series keeps
 * them, narrowed by `itemMatches`.
 */
const keepsOwnRows = (filter: HomeFilter) => filter.genre === undefined && filter.kind !== 'anime';

/** Whether an item of Continue Watching or Downloaded is one the filter shows. */
export function itemMatches(item: MediaItem, filter: HomeFilter): boolean {
  if (filter.kind === 'movies') return item.type === 'movie';
  if (filter.kind === 'shows') return item.type === 'show' || item.type === 'season' || item.type === 'episode';
  return true;
}

const rowIdentity = (row: TitlesRow) => `${row.kinds.join('+')}|${row.genre === undefined ? '' : genreKey(row.genre)}|${row.sort.by}|${row.sort.order}`;

/**
 * The rows the home shows. Unfiltered, the profile's rows that show; filtered,
 * each of them narrowed — a row left with nothing, or that no source can fill
 * any more, left out — and the filter's own row before them unless one of them
 * already is it, so a filtered home is never empty. Rows that become the same
 * row show once.
 */
export function narrowRows(rows: readonly HomeRowView[], filter: HomeFilter, feeds: HomeFeeds): readonly HomeRowView[] {
  const visible = rows.filter((row) => !row.hidden && row.available);
  if (!isFiltered(filter)) return visible;
  const shown: HomeRowView[] = [];
  const seen = new Set<string>();
  for (const row of visible) {
    if (row.type !== 'titles') {
      if (keepsOwnRows(filter)) shown.push(row);
      continue;
    }
    const narrowed = narrowRow(row, filter);
    if (!narrowed || !titlesAvailable(narrowed, feeds) || seen.has(rowIdentity(narrowed))) continue;
    seen.add(rowIdentity(narrowed));
    shown.push({ ...narrowed, available: true });
  }
  const own = filterRow(filter);
  if (!seen.has(rowIdentity(own))) {
    const first = shown.findIndex((row) => row.type === 'titles');
    // Kept even when no source can fill it, so the home can say why it is empty.
    shown.splice(first < 0 ? shown.length : first, 0, { ...own, available: titlesAvailable(own, feeds) });
  }
  return shown;
}

/**
 * "More like this": the title's first genre, across the kinds its type is found
 * in, rated highest first. Nothing for a title that names no genre, or for
 * anything but a film or a series.
 */
export function likeThis(item: MediaItem): RowSpec | undefined {
  const genre = item.genres[0];
  if (genre === undefined) return undefined;
  const kinds: readonly ContentKind[] | undefined =
    item.type === 'movie' ? ['movies', 'anime'] : item.type === 'show' ? ['shows', 'anime'] : undefined;
  return kinds ? { kinds, genre, sort: { by: 'rating', order: 'desc' } } : undefined;
}

/** The same title: the same item, or one another source matched to the same catalogue entry. */
export function isSameTitle(a: MediaItem, b: MediaItem): boolean {
  if (a.key.connectionId === b.key.connectionId && a.key.externalId === b.key.externalId) return true;
  return ['tmdb', 'imdb'].some((catalogue) => {
    const id = a.externalIds?.[catalogue];
    return id !== undefined && id === b.externalIds?.[catalogue];
  });
}
