import { describe, expect, it } from 'vitest';

import {
  addRow,
  DEFAULT_HOME_LAYOUT,
  moveRow,
  normalizeLayout,
  removeRow,
  setRow,
  type HomeRow,
} from '@/services/home-layout';

import { buildServices } from './support/services';

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe('home layout', () => {
  it('starts with continue watching, then films and series by release date, newest first', () => {
    const rows = normalizeLayout(undefined, new Set(['movies', 'shows']), true);
    expect(ids(rows)).toEqual(['continue', 'movies', 'shows', 'anime']);
    expect(rows.find((row) => row.id === 'movies')).toMatchObject({ sort: { by: 'releaseDate', order: 'desc' }, card: 'poster' });
    expect(rows.find((row) => row.id === 'anime')?.available).toBe(false);
  });

  it('keeps rows nobody feeds, marked unavailable, and repairs what is broken', () => {
    const stored = {
      version: 1 as const,
      rows: [
        { id: 'movies', type: 'kind', kind: 'movies', sort: { by: 'bogus', order: 'desc' }, card: 'poster', hidden: false, extra: false },
        { id: 'movies', type: 'kind', kind: 'movies', sort: { by: 'title', order: 'asc' }, card: 'poster', hidden: false, extra: false },
      ] as unknown as HomeRow[],
    };
    const rows = normalizeLayout(stored, new Set(['shows']), false);
    expect(ids(rows)).toEqual(['continue', 'movies', 'shows']);
    expect(rows[1]).toMatchObject({ sort: { by: 'releaseDate', order: 'desc' }, available: false });
    expect(rows[0]?.available).toBe(false);
  });

  it('moves, changes, adds and removes rows', () => {
    let rows: readonly HomeRow[] = DEFAULT_HOME_LAYOUT.rows;
    rows = moveRow(rows, 'shows', -1);
    expect(ids(rows)).toEqual(['continue', 'shows', 'movies', 'anime']);
    rows = setRow(rows, 'movies', { sort: { by: 'title', order: 'asc' }, hidden: true });
    expect(rows.find((row) => row.id === 'movies')).toMatchObject({ sort: { by: 'title', order: 'asc' }, hidden: true });
    rows = addRow(rows, 'movies', 'movies-added');
    expect(rows.at(-1)).toMatchObject({ kind: 'movies', sort: { by: 'addedAt', order: 'desc' }, extra: true });
    // A default row can only be hidden; an added one can go.
    expect(ids(removeRow(rows, 'movies'))).toContain('movies');
    expect(ids(removeRow(rows, 'movies-added'))).not.toContain('movies-added');
  });

  it('is stored per profile, and goes with the profile', async () => {
    const { services, stores } = buildServices({ plugins: [] });
    const kids = await services.profiles.create('Kids');
    const alex = await services.profiles.create('Alex');
    await services.homeLayout.update(alex.id, (rows) => moveRow(rows, 'shows', -1));
    expect(ids(await services.homeLayout.rows(alex.id))).toEqual(['continue', 'shows', 'movies', 'anime']);
    expect(ids(await services.homeLayout.rows(kids.id))).toEqual(['continue', 'movies', 'shows', 'anime']);
    await services.profiles.remove(alex.id);
    expect(await stores.preferences.get(alex.id)).toEqual({});
  });
});
