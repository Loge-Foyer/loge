import { encodeUtf8 } from './bytes';
import type { MediaItem } from './media';

/**
 * What a film, a series or an episode is apart from any source — so a
 * profile's watch state follows it from one source to another, and from one
 * language's copy to the next, where a provider keeps each language apart.
 *
 * In this order, the first the item carries: its TMDB id (`tmdb:movie:603`,
 * `tmdb:tv:1396`), then IMDb, TVDB, Kinopoisk and a video site's own id; then,
 * where the source is known to keep copies apart by language and
 * `byTitle` says so, its title and year; else the item on its source alone. An
 * episode is its show's identity with its season and number.
 */
export function watchIdentity(item: MediaItem, options: { readonly byTitle: boolean }): string {
  switch (item.type) {
    case 'movie':
      return catalogueOf('movie', item.externalIds) ?? titleOf('movie', item.originalTitle ?? item.title, item.year, options) ?? localOf(item);
    case 'show':
      return catalogueOf('tv', item.externalIds) ?? titleOf('show', item.originalTitle ?? item.title, item.year, options) ?? localOf(item);
    case 'season':
    case 'episode': {
      const show =
        catalogueOf('tv', item.showExternalIds) ??
        titleOf('show', item.showOriginalTitle ?? item.showTitle ?? '', item.showYear, options);
      if (show === undefined || item.seasonNumber === undefined) return localOf(item);
      if (item.type === 'season') return `${show}/s${item.seasonNumber}`;
      return item.episodeNumber === undefined ? localOf(item) : `${show}/s${item.seasonNumber}e${item.episodeNumber}`;
    }
    default:
      return localOf(item);
  }
}

/** The identity of an episode's show, or a show's own — what an episode's identity begins with. */
export function showIdentityOf(item: MediaItem, options: { readonly byTitle: boolean }): string | undefined {
  if (item.type === 'show') return watchIdentity(item, options);
  if (item.type !== 'season' && item.type !== 'episode') return undefined;
  return catalogueOf('tv', item.showExternalIds) ?? titleOf('show', item.showOriginalTitle ?? item.showTitle ?? '', item.showYear, options);
}

function catalogueOf(kind: 'movie' | 'tv', ids: Readonly<Record<string, string>> | undefined): string | undefined {
  if (!ids) return undefined;
  if (ids.tmdb) return `tmdb:${kind}:${ids.tmdb}`;
  if (ids.imdb) return `imdb:${ids.imdb}`;
  if (kind === 'tv' && ids.tvdb) return `tvdb:${ids.tvdb}`;
  if (ids.kinopoisk) return `kinopoisk:${ids.kinopoisk}`;
  if (ids.youtube) return `youtube:${ids.youtube}`;
  return undefined;
}

function titleOf(kind: 'movie' | 'show', name: string, year: number | undefined, options: { readonly byTitle: boolean }): string | undefined {
  if (!options.byTitle) return undefined;
  const plain = plainTitle(name);
  if (plain.title === '') return undefined;
  const known = year ?? plain.year;
  return `title:${kind}:${plain.title}${known === undefined ? '' : `:${known}`}`;
}

function localOf(item: MediaItem): string {
  return `item:${item.key.connectionId}:${item.key.externalId}`;
}

// What a provider writes after a film's name to tell its copies apart: a
// language, a quality, "new". Only ever taken off the end, in capitals, and
// never all of a title.
const TAGS = new Set([
  'HQ', 'HD', 'FHD', 'UHD', 'SD', '4K', '8K', 'HDR', 'HDR10', 'DV', '3D', 'NEU', 'NEW', 'MULTI', 'DUAL', 'SUB', 'OMU', 'OV',
  'DE', 'GER', 'EN', 'ENG', 'TR', 'TUR', 'FR', 'ES', 'IT', 'NL', 'PL', 'RU', 'AR', 'PT', 'EXYU',
]);

/**
 * A title without what a provider writes around it, and the year it wrote
 * into it: "Matrix (1999) DE 4K HDR" is "Matrix" from 1999, "INCEPTION -
 * 2010" is "INCEPTION" from 2010. A year in brackets, or after a dash at the
 * end, ends the title, and whatever follows it is the provider's marking; a
 * language or a quality is only ever taken off the end, in capitals, and
 * never all of a title. What a catalogue is asked to look up.
 */
export function bareTitle(name: string): { readonly title: string; readonly year?: number } {
  const trimmed = name.trim();
  // "(1999)", "[1999]" or " - 2010" — never a bare number, which "Blade Runner 2049" is part of its name.
  const mark = /\((1[89]\d\d|20\d\d)\)|\[(1[89]\d\d|20\d\d)\]|\s[-–]\s(1[89]\d\d|20\d\d)(?=\s|$)/.exec(trimmed);
  const marked = mark !== null && mark.index > 0;
  const year = marked ? Number(mark[1] ?? mark[2] ?? mark[3]) : undefined;
  const words = (marked ? trimmed.slice(0, mark.index) : trimmed).trim().split(/\s+/);
  while (words.length > 1 && TAGS.has(words[words.length - 1] ?? '')) words.pop();
  return { title: words.join(' '), ...(year === undefined ? {} : { year }) };
}

/** A title as a key — `bareTitle`, then `titleKey`: "Matrix (1999) DE 4K HDR" is `matrix` from 1999. */
export function plainTitle(name: string): { readonly title: string; readonly year?: number } {
  const bare = bareTitle(name);
  return { ...bare, title: titleKey(bare.title) };
}

/**
 * What two spellings of one title share: no accents, no case, no
 * punctuation. Empty for a title in a script other than Latin — which then
 * matches nothing, rather than every other such title.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Sixteen hex digits that stand for an identity in a record's key: the same on
 * every device, and short. FNV-1a over its UTF-8, twice with different
 * offsets, so 64 bits in all — never a secret, only a name.
 */
export function identityHash(identity: string): string {
  const bytes = encodeUtf8(identity);
  const pass = (offset: number) => {
    let hash = offset >>> 0;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  return pass(0x811c9dc5) + pass(0x050c5d1f);
}
