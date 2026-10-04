import { ITEM_SORTS, type ContentKind, type ItemSort, type UserId } from '@loge/api';

import type { RowSpec } from './media';
import type { PreferencesRepository } from './ports';
import { TAB_CONTENT } from './tab-content';

export type CardStyle = 'poster' | 'landscape';

/**
 * One of the profile's own rows: one kind or several, of every genre or of
 * one — "Movies", "Comedy" across films and series, "Comedy movies".
 */
export interface TitlesRow {
  readonly id: string;
  readonly type: 'titles';
  /** Media's kinds, in the tab's order, and never none. */
  readonly kinds: readonly ContentKind[];
  /** A genre, as a source names it. Absent: everything of the kinds. */
  readonly genre?: string;
  readonly sort: ItemSort;
  readonly card: CardStyle;
  readonly hidden: boolean;
  /** Added by the profile, so it can be removed; the defaults can only be hidden. */
  readonly extra: boolean;
}

export type HomeRow =
  | { readonly id: string; readonly type: 'continue'; readonly hidden: boolean }
  /** What this device keeps of the library: the profile's finished downloads, newest first. */
  | { readonly id: string; readonly type: 'downloads'; readonly hidden: boolean }
  | TitlesRow;

/** How versions 1 and 2 kept a row: one kind, every genre. */
interface KindRow {
  readonly id: string;
  readonly type: 'kind';
  readonly kind: ContentKind;
  readonly sort: ItemSort;
  readonly card: CardStyle;
  readonly hidden: boolean;
  readonly extra: boolean;
}

/** Continue Watching and Downloaded: the rows that are the app's, not the library's. */
type OwnRow = Exclude<HomeRow, TitlesRow>;

type LegacyRow = OwnRow | KindRow;

/**
 * The layout as a profile's preference keeps it, which every device on the
 * account reads. An app reads a version it does not know as no layout at all
 * and shows its defaults, rather than drawing rows it cannot:
 *
 * - 2 brought the Downloaded row; this app takes a 1 and adds it.
 * - 3 brought rows of several kinds and of one genre. A layout is written as a
 *   2 while every row still fits one (`layoutOf`), so a device on an older
 *   build keeps reading it until a row needs 3.
 */
export type HomeLayout =
  | { readonly version: 1 | 2; readonly rows: readonly LegacyRow[] }
  | { readonly version: 3; readonly rows: readonly HomeRow[] };

/** A row as the home shows it: whether any live source feeds it right now. */
export type HomeRowView = HomeRow & { readonly available: boolean };

/** What the profile's live sources feed: the kinds they bring, and those they can narrow to a genre. */
export interface HomeFeeds {
  readonly kinds: ReadonlySet<ContentKind>;
  readonly genreKinds: ReadonlySet<ContentKind>;
}

export const NEWEST_RELEASES: ItemSort = { by: 'releaseDate', order: 'desc' };
const NEWEST_ADDITIONS: ItemSort = { by: 'addedAt', order: 'desc' };

const CONTINUE_ROW: OwnRow = { id: 'continue', type: 'continue', hidden: false };
const DOWNLOADS_ROW: OwnRow = { id: 'downloads', type: 'downloads', hidden: false };

/** A kind's own row, known by the kind as its id. */
function defaultRow(kind: ContentKind): TitlesRow {
  return { id: kind, type: 'titles', kinds: [kind], sort: NEWEST_RELEASES, card: 'poster', hidden: false, extra: false };
}

export const DEFAULT_ROWS: readonly HomeRow[] = [CONTINUE_ROW, DOWNLOADS_ROW, ...TAB_CONTENT.media.map(defaultRow)];

/** A layout from before the Downloaded row has it after Continue, where a new one starts. */
function withDownloads(rows: readonly LegacyRow[]): readonly LegacyRow[] {
  if (rows.some((row) => row.type === 'downloads')) return rows;
  const at = rows.findIndex((row) => row.type === 'continue') + 1;
  return [...rows.slice(0, at), DOWNLOADS_ROW, ...rows.slice(at)];
}

function upgradeRow(row: LegacyRow): HomeRow {
  if (row.type !== 'kind') return row;
  const { kind, type: _kind, ...rest } = row;
  return { ...rest, type: 'titles', kinds: [kind] };
}

/** The rows a stored layout holds, brought up to the current version; the defaults for none, or one this app cannot read. */
export function rowsOf(layout: HomeLayout | undefined): readonly HomeRow[] {
  if (layout?.version === 3) return layout.rows;
  if (layout?.version === 2) return layout.rows.map(upgradeRow);
  if (layout?.version === 1) return withDownloads(layout.rows).map(upgradeRow);
  return DEFAULT_ROWS;
}

/** As a version 2 row, where one holds it: one kind, every genre. */
function legacyRow(row: HomeRow): LegacyRow | undefined {
  if (row.type !== 'titles') return row;
  const [kind, ...more] = row.kinds;
  if (kind === undefined || more.length > 0 || row.genre !== undefined) return undefined;
  const { kinds: _kinds, type: _titles, ...rest } = row;
  return { ...rest, type: 'kind', kind };
}

/** The rows as they are stored: the lowest version that holds them. */
export function layoutOf(rows: readonly HomeRow[]): HomeLayout {
  const legacy = rows.map(legacyRow);
  return legacy.every((row) => row !== undefined) ? { version: 2, rows: legacy } : { version: 3, rows };
}

/** Whether the live sources can fill a row: one of its kinds is fed — and, for a genre, by a source that can narrow to one. */
export function titlesAvailable(row: TitlesRow, feeds: HomeFeeds): boolean {
  return row.kinds.some((kind) => feeds.kinds.has(kind) && (row.genre === undefined || feeds.genreKinds.has(kind)));
}

/** What the row asks the sources for. */
export function specOf(row: TitlesRow): RowSpec {
  return { kinds: row.kinds, sort: row.sort, ...(row.genre === undefined ? {} : { genre: row.genre }) };
}

/**
 * The rows to show, from whatever was stored. Nothing is stored here: a kind
 * a source newly brings gets its default row, rows nobody feeds are kept but
 * marked unavailable, and anything malformed is repaired.
 */
export function normalizeLayout(stored: HomeLayout | undefined, feeds: HomeFeeds, canContinue: boolean, canKeep: boolean): readonly HomeRowView[] {
  const rows: HomeRow[] = [];
  const ids = new Set<string>();
  for (const row of rowsOf(stored)) {
    if (ids.has(row.id)) continue;
    // A row of a type this app does not know is one it cannot draw.
    if (row.type !== 'titles' && row.type !== 'continue' && row.type !== 'downloads') continue;
    const repaired = row.type === 'titles' ? repairTitles(row) : row;
    if (!repaired) continue;
    ids.add(row.id);
    rows.push(repaired);
  }
  if (!rows.some((row) => row.type === 'continue')) rows.unshift(CONTINUE_ROW);
  if (!rows.some((row) => row.type === 'downloads')) rows.splice(rows.findIndex((row) => row.type === 'continue') + 1, 0, DOWNLOADS_ROW);
  // A kind's own row is known by its id, so one the profile changed is never added again beside itself.
  for (const kind of TAB_CONTENT.media) {
    if (feeds.kinds.has(kind) && !ids.has(kind)) rows.push(defaultRow(kind));
  }
  return rows.map((row) => ({
    ...row,
    available: row.type === 'continue' ? canContinue : row.type === 'downloads' ? canKeep : titlesAvailable(row, feeds),
  }));
}

/** Media's kinds of it, each once and in the tab's order, a genre that says something, and a sort and a card style this app knows. */
function repairTitles(row: TitlesRow): TitlesRow | undefined {
  const kinds = TAB_CONTENT.media.filter((kind) => Array.isArray(row.kinds) && row.kinds.includes(kind));
  if (kinds.length === 0) return undefined;
  const { genre, ...rest } = row;
  const named = typeof genre === 'string' && genre.trim() !== '' ? genre.trim() : undefined;
  return {
    ...rest,
    kinds,
    ...(named === undefined ? {} : { genre: named }),
    sort: validSort(row.sort),
    card: row.card === 'landscape' ? 'landscape' : 'poster',
  };
}

export function moveRow(rows: readonly HomeRow[], id: string, by: -1 | 1): readonly HomeRow[] {
  const from = rows.findIndex((row) => row.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  const [row] = next.splice(from, 1);
  if (row) next.splice(to, 0, row);
  return next;
}

/** Changes a row: only whether it shows, for Continue and Downloaded; and a row keeps at least one kind. */
export function setRow(
  rows: readonly HomeRow[],
  id: string,
  change: Partial<Pick<TitlesRow, 'kinds' | 'sort' | 'card' | 'hidden'>>,
): readonly HomeRow[] {
  return rows.map((row) => {
    if (row.id !== id) return row;
    if (row.type !== 'titles') return change.hidden === undefined ? row : { ...row, hidden: change.hidden };
    const { kinds, ...rest } = change;
    const ordered = kinds === undefined ? row.kinds : TAB_CONTENT.media.filter((kind) => kinds.includes(kind));
    return { ...row, ...rest, kinds: ordered.length > 0 ? ordered : row.kinds };
  });
}

/** Narrows a row to one genre, or — `undefined` — to none. */
export function setGenre(rows: readonly HomeRow[], id: string, genre: string | undefined): readonly HomeRow[] {
  return rows.map((row) => {
    if (row.id !== id || row.type !== 'titles') return row;
    const { genre: _previous, ...rest } = row;
    return genre === undefined ? rest : { ...rest, genre };
  });
}

/**
 * A row the profile adds: of a genre, newest releases first; of every genre,
 * newest additions — a sensible second view of the same library.
 */
export function addRow(rows: readonly HomeRow[], what: { readonly kinds: readonly ContentKind[]; readonly genre?: string }, id: string): readonly HomeRow[] {
  const kinds = TAB_CONTENT.media.filter((kind) => what.kinds.includes(kind));
  if (kinds.length === 0) return rows;
  return [
    ...rows,
    {
      id,
      type: 'titles',
      kinds,
      ...(what.genre === undefined ? {} : { genre: what.genre }),
      sort: what.genre === undefined ? NEWEST_ADDITIONS : NEWEST_RELEASES,
      card: 'poster',
      hidden: false,
      extra: true,
    },
  ];
}

export function removeRow(rows: readonly HomeRow[], id: string): readonly HomeRow[] {
  return rows.filter((row) => !(row.id === id && row.type === 'titles' && row.extra));
}

function validSort(sort: ItemSort): ItemSort {
  const known = (ITEM_SORTS as readonly string[]).includes(sort.by);
  return known && (sort.order === 'asc' || sort.order === 'desc') ? sort : NEWEST_RELEASES;
}

export interface HomeLayoutService {
  /** The stored rows, or the defaults. Normalizing against live sources is the caller's step. */
  rows(userId: UserId): Promise<readonly HomeRow[]>;
  update(userId: UserId, change: (rows: readonly HomeRow[]) => readonly HomeRow[]): Promise<readonly HomeRow[]>;
  reset(userId: UserId): Promise<readonly HomeRow[]>;
}

export function createHomeLayoutService(preferences: PreferencesRepository): HomeLayoutService {
  return {
    rows: async (userId) => rowsOf((await preferences.get(userId)).homeLayout),
    update: async (userId, change) => {
      const next = await preferences.update(userId, (current) => ({
        ...current,
        homeLayout: layoutOf(change(rowsOf(current.homeLayout))),
      }));
      return rowsOf(next.homeLayout);
    },
    reset: async (userId) => {
      await preferences.update(userId, ({ homeLayout: _discarded, ...rest }) => rest);
      return DEFAULT_ROWS;
    },
  };
}
