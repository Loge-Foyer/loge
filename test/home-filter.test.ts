import { connectionId, type ContentKind, type MediaItem } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { filterRow, FILTER_ROW_ID, isSameTitle, itemMatches, likeThis, narrowRow, narrowRows } from '@/services/home-filter';
import { DEFAULT_ROWS, normalizeLayout, type HomeFeeds, type HomeRowView, type TitlesRow } from '@/services/home-layout';

import { movie } from './support/services';

const feeds = (kinds: readonly ContentKind[], genreKinds: readonly ContentKind[] = kinds): HomeFeeds => ({ kinds: new Set(kinds), genreKinds: new Set(genreKinds) });
const home = (rows = DEFAULT_ROWS, fed = feeds(['movies', 'shows'])) => normalizeLayout({ version: 3, rows }, fed, true, true);
const ids = (rows: readonly HomeRowView[]) => rows.map((row) => row.id);
const titles = (rows: readonly HomeRowView[]) => rows.filter((row): row is TitlesRow & HomeRowView => row.type === 'titles');
const row = (id: string, kinds: readonly ContentKind[], genre?: string): TitlesRow => ({
  id,
  type: 'titles',
  kinds,
  ...(genre === undefined ? {} : { genre }),
  sort: { by: 'releaseDate', order: 'desc' },
  card: 'poster',
  hidden: false,
  extra: true,
});
const home1 = connectionId('home');

describe('narrowing the home', () => {
  it('shows the profile’s rows that show, as they are, while nothing is chosen', () => {
    const rows = home();
    expect(ids(narrowRows(rows, {}, feeds(['movies', 'shows'])))).toEqual(['continue', 'downloads', 'movies', 'shows']);
  });

  it('narrows each row to the kind chosen, leaving out rows of other kinds, and keeps what is being watched', () => {
    const rows = home([...DEFAULT_ROWS, row('both', ['movies', 'shows'])]);
    const shown = narrowRows(rows, { kind: 'shows' }, feeds(['movies', 'shows']));
    expect(ids(shown)).toEqual(['continue', 'downloads', 'shows']);
    // "Movies & shows" narrowed to shows is the "Shows" row: it shows once.
    expect(titles(shown).map((each) => each.kinds)).toEqual([['shows']]);
  });

  it('narrows rows of every genre to the one chosen, leaves rows of another genre out, and hides what is being watched', () => {
    const rows = home([...DEFAULT_ROWS, row('drama', ['movies'], 'Drama'), row('comedy', ['movies', 'shows'], 'comedy')]);
    const shown = narrowRows(rows, { genre: 'Comedy' }, feeds(['movies', 'shows']));
    expect(ids(shown)).toEqual([FILTER_ROW_ID, 'movies', 'shows', 'comedy']);
    expect(titles(shown).find((each) => each.id === 'movies')).toMatchObject({ kinds: ['movies'], genre: 'Comedy' });
  });

  it('puts the filter’s own row first, unless one of the rows already is it', () => {
    const rows = home([...DEFAULT_ROWS, row('comedy-films', ['movies'], 'Comedy')]);
    const shown = narrowRows(rows, { kind: 'movies', genre: 'Comedy' }, feeds(['movies', 'shows']));
    // "Movies" narrowed is "Comedy movies", newest first: the filter's own row already.
    expect(ids(shown).filter((id) => id === FILTER_ROW_ID)).toEqual([]);
    const anime = narrowRows(rows, { kind: 'anime' }, feeds(['movies', 'shows', 'anime']));
    expect(ids(anime)).toEqual([FILTER_ROW_ID]);
  });

  it('keeps the filter’s own row where no source can fill it, so the home can say why it is empty', () => {
    const shown = narrowRows(home(), { genre: 'Comedy' }, feeds(['movies', 'shows'], []));
    expect(shown).toEqual([expect.objectContaining({ id: FILTER_ROW_ID, available: false })]);
  });

  it('narrows a row only where something of it is left', () => {
    expect(narrowRow(row('x', ['movies']), { kind: 'shows' })).toBeUndefined();
    expect(narrowRow(row('x', ['movies'], 'Drama'), { genre: 'Comedy' })).toBeUndefined();
    expect(narrowRow(row('x', ['movies', 'shows'], 'Comedy'), { genre: 'comedy', kind: 'shows' })).toMatchObject({ kinds: ['shows'], genre: 'Comedy' });
    expect(filterRow({})).toMatchObject({ kinds: ['movies', 'shows', 'anime'] });
  });

  it('matches what is being watched by its type', () => {
    const film = movie(home1, 'f', 2020);
    const episode = { ...film, type: 'episode', show: { connectionId: home1, externalId: 's' }, showTitle: 'S' } as const satisfies MediaItem;
    expect(itemMatches(film, { kind: 'movies' })).toBe(true);
    expect(itemMatches(episode, { kind: 'movies' })).toBe(false);
    expect(itemMatches(episode, { kind: 'shows' })).toBe(true);
    expect(itemMatches(episode, {})).toBe(true);
  });
});

describe('more like this', () => {
  it('is the title’s first genre, among the kinds of its type, the best rated first', () => {
    expect(likeThis(movie(home1, 'f', 2020, { genres: ['Drama', 'Crime'] }))).toEqual({
      kinds: ['movies', 'anime'],
      genre: 'Drama',
      sort: { by: 'rating', order: 'desc' },
    });
    expect(likeThis(movie(home1, 'f', 2020))).toBeUndefined();
  });

  it('knows the same title from another source by its catalogue id', () => {
    const here = movie(home1, 'a', 2020, { externalIds: { tmdb: '603' } });
    const there = movie(connectionId('other'), 'b', 2020, { externalIds: { tmdb: '603' } });
    expect(isSameTitle(here, there)).toBe(true);
    expect(isSameTitle(here, movie(connectionId('other'), 'c', 2020, { externalIds: { tmdb: '604' } }))).toBe(false);
  });
});
