import { connectionId, type Episode, type MediaItem, type MediaVersion, type Show } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { chipsFor } from '@/tabs/media/shared/filter-chips';
import { heroOf } from '@/tabs/media/shared/hero';
import { creditsOf, episodeLength, factsOf, leftOf, qualityBadges, qualityOf, seasonToOpen, tvInfoLines, upNextOf } from '@/tabs/media/shared/title-meta';

import { movie } from './support/services';

const home = connectionId('home');
const poster = { id: 'p' } as unknown as NonNullable<MediaItem['images']['poster']>;

const show = (id: string, extra: Partial<Show> = {}): Show => ({
  type: 'show',
  key: { connectionId: home, externalId: id },
  title: id,
  ratings: {},
  genres: [],
  images: {},
  ...extra,
});

const episode = (number: number, extra: Partial<Episode> = {}): Episode => ({
  type: 'episode',
  key: { connectionId: home, externalId: `e${number}` },
  title: `Episode ${number}`,
  show: { connectionId: home, externalId: 'show' },
  showTitle: 'The Show',
  seasonNumber: 1,
  episodeNumber: number,
  ratings: {},
  genres: [],
  images: {},
  ...extra,
});

const version = (height: number, extra: Partial<MediaVersion> = {}): MediaVersion => ({
  id: `v${height}`,
  video: { height },
  audio: [],
  subtitles: [],
  ...extra,
});

describe('the chips over the home', () => {
  it('offers the kinds the sources bring, series first, then Categories, while nothing is chosen', () => {
    expect(chipsFor({}, ['movies', 'anime', 'shows'])).toEqual([
      { type: 'kind', kind: 'shows', chosen: false },
      { type: 'kind', kind: 'movies', chosen: false },
      { type: 'kind', kind: 'anime', chosen: false },
      { type: 'categories' },
    ]);
  });

  it('leaves out a kind no source brings', () => {
    expect(chipsFor({}, ['movies'])).toEqual([{ type: 'kind', kind: 'movies', chosen: false }, { type: 'categories' }]);
  });

  it('puts a ✕ first and the chosen kind alone once a kind is chosen', () => {
    expect(chipsFor({ kind: 'movies' }, ['movies', 'shows'])).toEqual([
      { type: 'clear' },
      { type: 'kind', kind: 'movies', chosen: true },
      { type: 'categories' },
    ]);
  });

  it('names the chosen genre where Categories was, keeping the kinds offered', () => {
    expect(chipsFor({ genre: 'Comedy' }, ['movies', 'shows'])).toEqual([
      { type: 'clear' },
      { type: 'kind', kind: 'shows', chosen: false },
      { type: 'kind', kind: 'movies', chosen: false },
      { type: 'categories', genre: 'Comedy' },
    ]);
  });
});

describe('the title the home leads with', () => {
  it('is the first film or series not watched yet that has a poster, in the rows’ order', () => {
    const watched = movie(home, 'watched', 2020, { images: { poster }, watch: { played: true } });
    const bare = movie(home, 'bare', 2021);
    const wanted = show('wanted', { images: { poster } });
    expect(heroOf([[watched, bare], [episode(1, { images: { poster } }), wanted]])?.key.externalId).toBe('wanted');
  });

  it('falls back to a watched one with a poster, then to one on its plate', () => {
    const watched = movie(home, 'watched', 2020, { images: { poster }, watch: { played: true } });
    expect(heroOf([[movie(home, 'bare', 2021), watched]])?.key.externalId).toBe('watched');
    expect(heroOf([[movie(home, 'bare', 2021)]])?.key.externalId).toBe('bare');
  });

  it('is nothing where the rows hold no film or series', () => {
    expect(heroOf([[episode(1)], []])).toBeUndefined();
  });
});

describe('what a title page says of a title', () => {
  it('names the best version’s quality as 4K, HD or SD — nothing where the source did not say', () => {
    expect(qualityOf([version(720), version(2160)])).toBe('4K');
    expect(qualityOf([version(1080)])).toBe('HD');
    expect(qualityOf([version(480)])).toBe('SD');
    expect(qualityOf([])).toBeUndefined();
    expect(qualityOf(undefined)).toBeUndefined();
  });

  it('boxes how the best version looks and sounds', () => {
    const best = version(2160, { video: { height: 2160, hdr: 'dolby-vision' }, audio: [{ codec: 'eac3' }, { codec: 'truehd', spatial: 'dolby-atmos' }] });
    expect(qualityBadges([version(1080), best])).toEqual(['4K', 'Dolby Vision', 'Dolby Atmos']);
    expect(qualityBadges([version(1080)])).toEqual(['HD']);
  });

  it('gives a film’s year and length, and a series’ years and seasons', () => {
    expect(factsOf(movie(home, 'film', 1999, { runtimeMs: 136 * 60_000 }))).toEqual(['1999', '2 h 16 min']);
    expect(factsOf(show('series', { year: 2019, endYear: 2023, seasonCount: 4 }))).toEqual(['2019–2023', '4 seasons']);
    expect(factsOf(show('series', { year: 2025, endYear: 2025, seasonCount: 1 }))).toEqual(['2025', '1 season']);
  });

  it('credits the actors, then the directors — or a series’ writers where it has none', () => {
    expect(
      creditsOf([
        { name: 'A', kind: 'actor' },
        { name: 'D', kind: 'director' },
        { name: 'W', kind: 'writer' },
      ]),
    ).toEqual({ cast: ['A'], makers: ['D'], makersLabel: 'Director' });
    expect(creditsOf([{ name: 'W', kind: 'writer' }])).toEqual({ cast: [], makers: ['W'], makersLabel: 'Creators' });
  });

  it('says how long is left only of something begun and not finished', () => {
    const film = (watch: MediaItem['watch']) => movie(home, 'film', 2000, { runtimeMs: 100 * 60_000, ...(watch ? { watch } : {}) });
    expect(leftOf(film({ played: false, positionMs: 40 * 60_000 }))).toBe('60 min left');
    expect(leftOf(film({ played: false, positionMs: 0 }))).toBeUndefined();
    expect(leftOf(film({ played: true, positionMs: 40 * 60_000 }))).toBeUndefined();
    expect(leftOf(film(undefined))).toBeUndefined();
    expect(episodeLength(episode(1, { runtimeMs: 45 * 60_000, watch: { played: false, positionMs: 0 } }))).toBe('45 min');
  });

  it('gives a TV row two lines: an episode by its code and name, anything else by its facts and genres', () => {
    expect(tvInfoLines(episode(4, { seasonNumber: 3, title: 'Old Friends', runtimeMs: 30 * 60_000, watch: { played: false, positionMs: 10 * 60_000 } }))).toEqual([
      'S3 · E4 · Old Friends',
      '20 min left',
    ]);
    expect(tvInfoLines(movie(home, 'Film', 2001, { runtimeMs: 90 * 60_000, genres: ['Drama', 'Crime', 'War', 'History'] }))).toEqual([
      'Film · 2001 · 1 h 30 min',
      'Drama · Crime · War',
    ]);
  });
});

describe('what Play plays of a series', () => {
  it('opens on the chosen season, else the first not watched through, else the first', () => {
    const season = (id: string, played?: boolean): MediaItem => ({
      type: 'season',
      key: { connectionId: home, externalId: id },
      title: id,
      show: { connectionId: home, externalId: 'show' },
      ratings: {},
      genres: [],
      images: {},
      ...(played === undefined ? {} : { watch: { played } }),
    });
    const seasons = [season('s1', true), season('s2', false), season('s3', false)];
    expect(seasonToOpen(seasons, 's3')?.key.externalId).toBe('s3');
    expect(seasonToOpen(seasons)?.key.externalId).toBe('s2');
    expect(seasonToOpen([season('s1'), season('s2')])?.key.externalId).toBe('s1');
    expect(seasonToOpen([])).toBeUndefined();
  });

  it('plays the episode part-way through, else the first not watched, else — watched through — the first', () => {
    const done = { played: true };
    expect(upNextOf([episode(1, { watch: done }), episode(2), episode(3, { watch: { played: false, positionMs: 5000 } })])?.episodeNumber).toBe(3);
    expect(upNextOf([episode(1, { watch: done }), episode(2), episode(3)])?.episodeNumber).toBe(2);
    expect(upNextOf([episode(1, { watch: done }), episode(2, { watch: done })])?.episodeNumber).toBe(1);
    expect(upNextOf([])).toBeUndefined();
  });
});
