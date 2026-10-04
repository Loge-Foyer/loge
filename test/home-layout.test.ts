import type { ContentKind } from '@loge/api';
import { describe, expect, it } from 'vitest';

import {
  addRow,
  DEFAULT_ROWS,
  layoutOf,
  moveRow,
  normalizeLayout,
  removeRow,
  rowsOf,
  setGenre,
  setRow,
  type HomeFeeds,
  type HomeLayout,
  type HomeRow,
} from '@/services/home-layout';

import { ENGINES, type Engine } from './support/engines';
import { buildServices } from './support/services';

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);
const feeds = (kinds: readonly ContentKind[], genreKinds: readonly ContentKind[] = []): HomeFeeds => ({ kinds: new Set(kinds), genreKinds: new Set(genreKinds) });
const legacy = (id: string, kind: ContentKind, extra = false) =>
  ({ id, type: 'kind', kind, sort: { by: 'releaseDate', order: 'desc' }, card: 'poster', hidden: false, extra }) as const;

describe('home layout', () => {
  it('starts with continue watching and what is kept, then films and series by release date, newest first', () => {
    const rows = normalizeLayout(undefined, feeds(['movies', 'shows']), true, true);
    expect(ids(rows)).toEqual(['continue', 'downloads', 'movies', 'shows', 'anime']);
    expect(rows.find((row) => row.id === 'movies')).toMatchObject({ kinds: ['movies'], sort: { by: 'releaseDate', order: 'desc' }, card: 'poster' });
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
      ],
    } as unknown as HomeLayout;
    const rows = normalizeLayout(stored, feeds(['shows']), false, false);
    expect(ids(rows)).toEqual(['continue', 'downloads', 'movies', 'shows']);
    expect(rows[2]).toMatchObject({ type: 'titles', kinds: ['movies'], sort: { by: 'releaseDate', order: 'desc' }, available: false });
    expect(rows[0]?.available).toBe(false);
    // A device that keeps nothing — a TV, a browser — has nothing to show in it.
    expect(rows[1]?.available).toBe(false);
  });

  it('repairs a row of several kinds: Media’s kinds only, each once, in the tab’s order — and drops one left with none', () => {
    const stored: HomeLayout = {
      version: 3,
      rows: [
        { id: 'mixed', type: 'titles', kinds: ['shows', 'videos', 'movies', 'shows'], genre: '  Comedy ', sort: { by: 'rating', order: 'desc' }, card: 'tile' as never, hidden: false, extra: true },
        { id: 'blank', type: 'titles', kinds: ['movies'], genre: '   ', sort: { by: 'title', order: 'asc' }, card: 'landscape', hidden: false, extra: true },
        { id: 'none', type: 'titles', kinds: ['videos'], sort: { by: 'title', order: 'asc' }, card: 'poster', hidden: false, extra: true },
      ],
    };
    const rows = normalizeLayout(stored, feeds(['movies', 'shows'], ['movies', 'shows']), true, true);
    expect(rows.find((row) => row.id === 'mixed')).toMatchObject({ kinds: ['movies', 'shows'], genre: 'Comedy', card: 'poster' });
    expect(rows.find((row) => row.id === 'blank')).not.toHaveProperty('genre');
    expect(ids(rows)).not.toContain('none');
  });

  it('never adds a kind’s own row beside the one the profile changed', () => {
    const stored: HomeLayout = {
      version: 3,
      rows: [{ id: 'movies', type: 'titles', kinds: ['movies', 'shows'], genre: 'Comedy', sort: { by: 'releaseDate', order: 'desc' }, card: 'poster', hidden: false, extra: false }],
    };
    const rows = normalizeLayout(stored, feeds(['movies', 'shows'], ['movies']), true, true);
    expect(ids(rows)).toEqual(['continue', 'downloads', 'movies', 'shows']);
  });

  it('marks a genre row available only where a source of its kinds can narrow to a genre', () => {
    const stored: HomeLayout = {
      version: 3,
      rows: [
        { id: 'comedy', type: 'titles', kinds: ['movies', 'shows'], genre: 'Comedy', sort: { by: 'releaseDate', order: 'desc' }, card: 'poster', hidden: false, extra: true },
      ],
    };
    const comedy = (genreKinds: readonly ContentKind[]) =>
      normalizeLayout(stored, feeds(['movies', 'shows'], genreKinds), true, true).find((row) => row.id === 'comedy')?.available;
    expect(comedy([])).toBe(false);
    expect(comedy(['shows'])).toBe(true);
  });

  it('reads a layout from before the Downloaded row, and one of single kinds, as rows of kinds', () => {
    const before: HomeLayout = { version: 1, rows: [legacy('shows', 'shows'), { id: 'continue', type: 'continue', hidden: true }, legacy('movies', 'movies')] };
    expect(ids(rowsOf(before))).toEqual(['shows', 'continue', 'downloads', 'movies']);
    expect(rowsOf(before).find((row) => row.id === 'continue')?.hidden).toBe(true);
    expect(rowsOf({ version: 2, rows: [legacy('movies-x', 'movies', true)] })).toEqual([
      { id: 'movies-x', type: 'titles', kinds: ['movies'], sort: { by: 'releaseDate', order: 'desc' }, card: 'poster', hidden: false, extra: true },
    ]);
    // A version this app cannot read is no layout at all.
    expect(rowsOf({ version: 4 } as never)).toEqual(DEFAULT_ROWS);
  });

  it('is written as the lowest version that holds it, so an older app keeps reading it', () => {
    const plain = moveRow(DEFAULT_ROWS, 'shows', -1);
    const two = layoutOf(plain);
    expect(two.version).toBe(2);
    expect(two.rows.find((row) => row.id === 'movies')).toEqual(legacy('movies', 'movies'));
    expect(rowsOf(two)).toEqual(plain);
    const comedy = addRow(plain, { kinds: ['movies', 'shows'], genre: 'Comedy' }, 'row-comedy');
    const three = layoutOf(comedy);
    expect(three.version).toBe(3);
    expect(rowsOf(three)).toEqual(comedy);
    expect(layoutOf(addRow(plain, { kinds: ['movies', 'shows'] }, 'row-both')).version).toBe(3);
  });

  it('moves, changes, adds and removes rows', () => {
    let rows: readonly HomeRow[] = DEFAULT_ROWS;
    rows = moveRow(rows, 'shows', -1);
    expect(ids(rows)).toEqual(['continue', 'downloads', 'shows', 'movies', 'anime']);
    rows = setRow(rows, 'movies', { sort: { by: 'title', order: 'asc' }, hidden: true });
    expect(rows.find((row) => row.id === 'movies')).toMatchObject({ sort: { by: 'title', order: 'asc' }, hidden: true });
    // What is kept can be hidden and moved, and nothing else.
    rows = setRow(rows, 'downloads', { hidden: true, card: 'poster' });
    expect(rows.find((row) => row.id === 'downloads')).toEqual({ id: 'downloads', type: 'downloads', hidden: true });
    rows = moveRow(rows, 'downloads', 1);
    expect(ids(rows)).toEqual(['continue', 'shows', 'downloads', 'movies', 'anime']);
    rows = addRow(rows, { kinds: ['movies'] }, 'row-added');
    expect(rows.at(-1)).toMatchObject({ type: 'titles', kinds: ['movies'], sort: { by: 'addedAt', order: 'desc' }, extra: true });
    // A default row can only be hidden; an added one can go.
    expect(ids(removeRow(rows, 'movies'))).toContain('movies');
    expect(ids(removeRow(rows, 'downloads'))).toContain('downloads');
    expect(ids(removeRow(rows, 'row-added'))).not.toContain('row-added');
  });

  it('narrows a row to kinds and a genre, and widens it again', () => {
    let rows = addRow(DEFAULT_ROWS, { kinds: ['shows', 'movies'], genre: 'Comedy' }, 'row-comedy');
    expect(rows.at(-1)).toMatchObject({ kinds: ['movies', 'shows'], genre: 'Comedy', sort: { by: 'releaseDate', order: 'desc' } });
    rows = setRow(rows, 'row-comedy', { kinds: ['shows'] });
    expect(rows.at(-1)).toMatchObject({ kinds: ['shows'] });
    // A row keeps at least one kind.
    rows = setRow(rows, 'row-comedy', { kinds: [] });
    expect(rows.at(-1)).toMatchObject({ kinds: ['shows'] });
    rows = setGenre(rows, 'row-comedy', undefined);
    expect(rows.at(-1)).not.toHaveProperty('genre');
    rows = setGenre(rows, 'row-comedy', 'Drama');
    expect(rows.at(-1)).toMatchObject({ genre: 'Drama' });
    // Nothing to add without a kind.
    expect(addRow(DEFAULT_ROWS, { kinds: [] }, 'row-none')).toBe(DEFAULT_ROWS);
  });

  it.each(ENGINES)('is stored per profile, and goes with the profile (%s)', async (engine: Engine) => {
    const { services, db } = buildServices({ plugins: [], engine });
    const kids = await services.profiles.create('Kids');
    const alex = await services.profiles.create('Alex');
    await services.homeLayout.update(alex.id, (rows) => moveRow(rows, 'shows', -1));
    expect(ids(await services.homeLayout.rows(alex.id))).toEqual(['continue', 'downloads', 'shows', 'movies', 'anime']);
    expect(ids(await services.homeLayout.rows(kids.id))).toEqual(['continue', 'downloads', 'movies', 'shows', 'anime']);
    expect((await db.preferences.get(alex.id)).homeLayout?.version).toBe(2);
    await services.homeLayout.update(alex.id, (rows) => addRow(rows, { kinds: ['movies', 'shows'], genre: 'Comedy' }, 'row-comedy'));
    expect((await db.preferences.get(alex.id)).homeLayout?.version).toBe(3);
    expect((await services.homeLayout.rows(alex.id)).at(-1)).toMatchObject({ id: 'row-comedy', genre: 'Comedy' });
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
