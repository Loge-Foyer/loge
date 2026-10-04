import type { MediaItem } from '@loge/api';

/**
 * The title the home leads with: from its rows in order, the first film or
 * series not watched yet that has a poster to show; else the first with one;
 * else — a source with no artwork — the first not watched, on its plate.
 */
export function heroOf(rows: readonly (readonly MediaItem[])[]): MediaItem | undefined {
  const titles = rows.flat().filter((item) => item.type === 'movie' || item.type === 'show');
  const pictured = titles.filter((item) => item.images.poster !== undefined);
  const unwatched = (items: readonly MediaItem[]) => items.find((item) => !item.watch?.played);
  return unwatched(pictured) ?? pictured[0] ?? unwatched(titles) ?? titles[0];
}
