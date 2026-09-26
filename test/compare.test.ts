import { compareItems, connectionId, mergeSorted, type MediaItem, type Movie } from '@sc/api';
import { describe, expect, it } from 'vitest';

function movie(id: string, extra: Partial<Movie> = {}): MediaItem {
  return {
    type: 'movie',
    key: { connectionId: connectionId('c1'), externalId: id },
    title: id,
    ratings: {},
    genres: [],
    images: {},
    ...extra,
  };
}

const ids = (items: readonly MediaItem[]) => items.map((item) => item.key.externalId);

describe('compareItems', () => {
  it('sorts by release date, newest first', () => {
    const items = [
      movie('old', { releaseDate: '1999-03-31' }),
      movie('new', { releaseDate: '2024-06-01' }),
      movie('mid', { releaseDate: '2010-01-15' }),
    ];
    expect(ids(items.toSorted(compareItems({ by: 'releaseDate', order: 'desc' })))).toEqual(['new', 'mid', 'old']);
  });

  it('falls back to January 1 of the year when there is no date', () => {
    const items = [movie('dated', { releaseDate: '2010-06-01' }), movie('yearOnly', { year: 2010 })];
    expect(ids(items.toSorted(compareItems({ by: 'releaseDate', order: 'desc' })))).toEqual(['dated', 'yearOnly']);
  });

  it('puts missing values last when descending and first when ascending, as Jellyfin does', () => {
    const items = [movie('rated', { ratings: { community: 7 } }), movie('unrated')];
    expect(ids(items.toSorted(compareItems({ by: 'rating', order: 'desc' })))).toEqual(['rated', 'unrated']);
    expect(ids(items.toSorted(compareItems({ by: 'rating', order: 'asc' })))).toEqual(['unrated', 'rated']);
  });

  it('breaks ties on the sort title, then the id, so the order is total', () => {
    const items = [
      movie('b', { title: 'Same', addedAt: '2024-01-01T00:00:00Z' }),
      movie('a', { title: 'Same', addedAt: '2024-01-01T00:00:00Z' }),
      movie('c', { title: 'Alpha', addedAt: '2024-01-01T00:00:00Z' }),
    ];
    expect(ids(items.toSorted(compareItems({ by: 'addedAt', order: 'desc' })))).toEqual(['c', 'a', 'b']);
  });

  it('sorts titles by their sort title, ignoring case', () => {
    const items = [movie('x', { title: 'The Zoo', sortTitle: 'zoo' }), movie('y', { title: 'apple' })];
    expect(ids(items.toSorted(compareItems({ by: 'title', order: 'asc' })))).toEqual(['y', 'x']);
    expect(ids(items.toSorted(compareItems({ by: 'title', order: 'desc' })))).toEqual(['x', 'y']);
  });
});

describe('mergeSorted', () => {
  const byNumber = (a: number, b: number) => a - b;

  it('merges sorted lists and says where each value came from', () => {
    expect(mergeSorted([[1, 4, 9], [2, 3], []], byNumber)).toEqual([
      { value: 1, list: 0 },
      { value: 2, list: 1 },
      { value: 3, list: 1 },
      { value: 4, list: 0 },
      { value: 9, list: 0 },
    ]);
  });

  it('stops at the limit', () => {
    expect(mergeSorted([[1, 4], [2, 3]], byNumber, 3).map((entry) => entry.value)).toEqual([1, 2, 3]);
  });
});
