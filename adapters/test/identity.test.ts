import { bareTitle, connectionId, identityHash, plainTitle, titleKey, watchIdentity, type Episode, type MediaItem, type Movie } from '@loge/api';
import { describe, expect, it } from 'vitest';

const key = (externalId: string) => ({ connectionId: connectionId('c1'), externalId });
const film = (fields: Partial<Movie> & { title: string }): Movie => ({ type: 'movie', key: key('vod:1'), ratings: {}, genres: [], images: {}, ...fields });
const episode = (fields: Partial<Episode>): Episode => ({
  type: 'episode',
  key: key('episode:1'),
  title: 'Pilot',
  show: key('show:1'),
  showTitle: 'Breaking Bad (2008) DE',
  seasonNumber: 1,
  episodeNumber: 3,
  ratings: {},
  genres: [],
  images: {},
  ...fields,
});

describe('plainTitle', () => {
  it('takes off what a provider marks its copies with, and keeps the year it wrote', () => {
    expect(plainTitle('Matrix (1999) DE 4K HDR')).toEqual({ title: 'matrix', year: 1999 });
    expect(plainTitle('INCEPTION - 2010')).toEqual({ title: 'inception', year: 2010 });
    expect(plainTitle('Inception HQ')).toEqual({ title: 'inception' });
    expect(plainTitle('Breaking Bad (2008) TR')).toEqual({ title: 'breaking bad', year: 2008 });
    expect(plainTitle('Dark Matter – Der Zeitenläufer (2024) DE')).toEqual({ title: 'dark matter der zeitenlaufer', year: 2024 });
  });

  it('keeps a number that is part of the name, and never takes a whole title away', () => {
    expect(plainTitle('Blade Runner 2049')).toEqual({ title: 'blade runner 2049' });
    expect(plainTitle('IT')).toEqual({ title: 'it' });
    expect(plainTitle('IT (2017) DE')).toEqual({ title: 'it', year: 2017 });
  });
});

describe('bareTitle and titleKey', () => {
  it('leaves the title as it was written, for a catalogue to look up', () => {
    expect(bareTitle('Matrix (1999) DE 4K HDR')).toEqual({ title: 'Matrix', year: 1999 });
    expect(bareTitle('  Amélie [2001] FR ')).toEqual({ title: 'Amélie', year: 2001 });
    expect(bareTitle('Dark Matter – Der Zeitenläufer (2024) DE')).toEqual({ title: 'Dark Matter – Der Zeitenläufer', year: 2024 });
  });

  it('keys a title by what its spellings share, and a title in another script by nothing', () => {
    expect(titleKey('Le Fabuleux Destin d’Amélie Poulain')).toBe('le fabuleux destin d amelie poulain');
    expect(titleKey('Spider-Man: No Way Home')).toBe('spider man no way home');
    expect(titleKey('Брат')).toBe('');
  });
});

describe('watchIdentity', () => {
  it('prefers the catalogue the source matched it to, so every copy is one', () => {
    expect(watchIdentity(film({ title: 'Matrix (1999) DE 4K HDR', externalIds: { tmdb: '603' } }), { byTitle: true })).toBe('tmdb:movie:603');
    expect(watchIdentity(film({ title: 'Matrix HQ', key: key('vod:2'), externalIds: { tmdb: '603', imdb: 'tt0133093' } }), { byTitle: true })).toBe(
      'tmdb:movie:603',
    );
    expect(watchIdentity(film({ title: 'A', externalIds: { imdb: 'tt0133093' } }), { byTitle: false })).toBe('imdb:tt0133093');
    expect(watchIdentity(film({ title: 'A video', externalIds: { youtube: 'dQw4w9WgXcQ' } }), { byTitle: false })).toBe('youtube:dQw4w9WgXcQ');
  });

  it('falls back on the title and year only where the source keeps copies apart by language', () => {
    const copy = film({ title: 'Matrix Revolutions (2003) DE', year: 2003 });
    expect(watchIdentity(copy, { byTitle: true })).toBe('title:movie:matrix revolutions:2003');
    expect(watchIdentity(film({ title: 'Matrix Revolutions', originalTitle: 'The Matrix Revolutions', year: 2003 }), { byTitle: true })).toBe(
      'title:movie:the matrix revolutions:2003',
    );
    // A file on a share is that file, and nothing else of the same name.
    expect(watchIdentity(copy, { byTitle: false })).toBe('item:c1:vod:1');
  });

  it('knows an episode by its show, its season and its number', () => {
    expect(watchIdentity(episode({ showExternalIds: { tmdb: '1396' } }), { byTitle: true })).toBe('tmdb:tv:1396/s1e3');
    expect(watchIdentity(episode({ showYear: 2008 }), { byTitle: true })).toBe('title:show:breaking bad:2008/s1e3');
    // Without a number there is nothing to match it by.
    const { episodeNumber: _number, ...unnumbered } = episode({ showExternalIds: { tmdb: '1396' } });
    expect(watchIdentity(unnumbered as MediaItem, { byTitle: true })).toBe('item:c1:episode:1');
  });
});

describe('identityHash', () => {
  it('is sixteen hex digits, the same for the same identity', () => {
    expect(identityHash('tmdb:movie:603')).toMatch(/^[0-9a-f]{16}$/);
    expect(identityHash('tmdb:movie:603')).toBe(identityHash('tmdb:movie:603'));
    expect(identityHash('tmdb:movie:603')).not.toBe(identityHash('tmdb:movie:604'));
    // Over UTF-8, so a title in any script hashes the same on every engine.
    expect(identityHash('title:movie:żółw')).toBe(identityHash('title:movie:żółw'));
  });
});
