import { describe, expect, it } from 'vitest';

import {
  addRow,
  DEFAULT_HOME_LAYOUT,
  moveRow,
  normalizeLayout,
  removeRow,
  rowsOf,
  setRow,
  type HomeRow,
} from '@/services/home-layout';

import { ENGINES, type Engine } from './support/engines';
import { buildServices } from './support/services';

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe('home layout', () => {
  it('starts with continue watching and what is kept, then films and series by release date, newest first', () => {
    const rows = normalizeLayout(undefined, new Set(['movies', 'shows']), true, true);
    expect(ids(rows)).toEqual(['continue', 'downloads', 'movies', 'shows', 'anime']);
    expect(rows.find((row) => row.id === 'movies')).toMatchObject({ sort: { by: 'releaseDate', order: 'desc' }, card: 'poster' });
    expect(rows.find((row) => row.id === 'anime')?.available).toBe(false);
    expect(rows.find((row) => row.id === 'downloads')?.available).toBe(true);
  });

  it('keeps rows nobody feeds, marked unavailable, and repairs what is broken', () => {
    const stored = {
      version: 2 as const,
      rows: [
        { id: 'movies', type: 'kind', kind: 'movies', sort: { by: 'bogus', order: 'desc' }, card: 'poster', hidden: false, extra: false },
        { id: 'movies', type: 'kind', kind: 'movies', sort: { by: 'title', order: 'asc' }, card: 'poster', hidden: false, extra: false },
        { id: 'later', type: 'from-a-newer-app', hidden: false },
      ] as unknown as HomeRow[],
    };
    const rows = normalizeLayout(stored, new Set(['shows']), false, false);
    expect(ids(rows)).toEqual(['continue', 'downloads', 'movies', 'shows']);
    expect(rows[2]).toMatchObject({ sort: { by: 'releaseDate', order: 'desc' }, available: false });
    expect(rows[0]?.available).toBe(false);
    // A device that keeps nothing — a TV, a browser — has nothing to show in it.
    expect(rows[1]?.available).toBe(false);
  });

  it('gives a layout from before the Downloaded row one, right after continue watching', () => {
    const before = {
      version: 1 as const,
      rows: [
        { id: 'shows', type: 'kind', kind: 'shows', sort: { by: 'releaseDate', order: 'desc' }, card: 'poster', hidden: false, extra: false },
        { id: 'continue', type: 'continue', hidden: true },
        { id: 'movies', type: 'kind', kind: 'movies', sort: { by: 'releaseDate', order: 'desc' }, card: 'poster', hidden: false, extra: false },
      ] as HomeRow[],
    };
    expect(ids(rowsOf(before))).toEqual(['shows', 'continue', 'downloads', 'movies']);
    expect(rowsOf(before).find((row) => row.id === 'continue')?.hidden).toBe(true);
    // A version this app cannot read is no layout at all.
    expect(rowsOf({ version: 3 } as never)).toEqual(DEFAULT_HOME_LAYOUT.rows);
  });

  it('moves, changes, adds and removes rows', () => {
    let rows: readonly HomeRow[] = DEFAULT_HOME_LAYOUT.rows;
    rows = moveRow(rows, 'shows', -1);
    expect(ids(rows)).toEqual(['continue', 'downloads', 'shows', 'movies', 'anime']);
    rows = setRow(rows, 'movies', { sort: { by: 'title', order: 'asc' }, hidden: true });
    expect(rows.find((row) => row.id === 'movies')).toMatchObject({ sort: { by: 'title', order: 'asc' }, hidden: true });
    // What is kept can be hidden and moved, and nothing else.
    rows = setRow(rows, 'downloads', { hidden: true, card: 'poster' });
    expect(rows.find((row) => row.id === 'downloads')).toEqual({ id: 'downloads', type: 'downloads', hidden: true });
    rows = moveRow(rows, 'downloads', 1);
    expect(ids(rows)).toEqual(['continue', 'shows', 'downloads', 'movies', 'anime']);
    rows = addRow(rows, 'movies', 'movies-added');
    expect(rows.at(-1)).toMatchObject({ kind: 'movies', sort: { by: 'addedAt', order: 'desc' }, extra: true });
    // A default row can only be hidden; an added one can go.
    expect(ids(removeRow(rows, 'movies'))).toContain('movies');
    expect(ids(removeRow(rows, 'downloads'))).toContain('downloads');
    expect(ids(removeRow(rows, 'movies-added'))).not.toContain('movies-added');
  });

  it.each(ENGINES)('is stored per profile, and goes with the profile (%s)', async (engine: Engine) => {
    const { services, db } = buildServices({ plugins: [], engine });
    const kids = await services.profiles.create('Kids');
    const alex = await services.profiles.create('Alex');
    await services.homeLayout.update(alex.id, (rows) => moveRow(rows, 'shows', -1));
    expect(ids(await services.homeLayout.rows(alex.id))).toEqual(['continue', 'downloads', 'shows', 'movies', 'anime']);
    expect(ids(await services.homeLayout.rows(kids.id))).toEqual(['continue', 'downloads', 'movies', 'shows', 'anime']);
    expect((await db.preferences.get(alex.id)).homeLayout?.version).toBe(2);
    // Reset is a deletion of the one preference, not a rewrite of all of them.
    await services.homeLayout.reset(alex.id);
    expect(await db.preferences.get(alex.id)).toEqual({});
    await services.homeLayout.update(alex.id, (rows) => moveRow(rows, 'shows', -1));
    await services.profiles.remove(alex.id);
    expect(await db.preferences.get(alex.id)).toEqual({});
  });

  it.each(ENGINES)('moves the Downloaded row of a layout stored before it existed (%s)', async (engine: Engine) => {
    const { services, db } = buildServices({ plugins: [], engine });
    const kids = await services.profiles.create('Kids');
    await db.preferences.update(kids.id, (current) => ({ ...current, homeLayout: { version: 1, rows: [{ id: 'continue', type: 'continue', hidden: false }] } }));
    await services.homeLayout.update(kids.id, (rows) => moveRow(rows, 'downloads', -1));
    expect(ids(await services.homeLayout.rows(kids.id))).toEqual(['downloads', 'continue']);
  });
});
