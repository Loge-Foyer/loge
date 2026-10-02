import { ITEM_SORTS, type ContentKind, type ItemSort, type UserId } from '@sc/api';

import type { PreferencesRepository } from './ports';
import { TAB_CONTENT } from './tab-content';

export type CardStyle = 'poster' | 'landscape';

export type HomeRow =
  | { readonly id: string; readonly type: 'continue'; readonly hidden: boolean }
  /** What this device keeps of the library: the profile's finished downloads, newest first. */
  | { readonly id: string; readonly type: 'downloads'; readonly hidden: boolean }
  | {
      readonly id: string;
      readonly type: 'kind';
      readonly kind: ContentKind;
      readonly sort: ItemSort;
      readonly card: CardStyle;
      readonly hidden: boolean;
      /** Added by the profile, so it can be removed; the defaults can only be hidden. */
      readonly extra: boolean;
    };

/**
 * 2 brought the Downloaded row. A layout is a preference every device on the
 * account reads, and an app that knows only 1 would draw an unknown row as a
 * kind with none: it reads a 2 as no layout at all and shows its defaults,
 * while this one takes a 1 and adds the row.
 */
export interface HomeLayout {
  readonly version: 1 | 2;
  readonly rows: readonly HomeRow[];
}

/** A row as the home shows it: whether any live source feeds it right now. */
export type HomeRowView = HomeRow & { readonly available: boolean };

export const NEWEST_RELEASES: ItemSort = { by: 'releaseDate', order: 'desc' };

const CONTINUE_ROW: HomeRow = { id: 'continue', type: 'continue', hidden: false };
const DOWNLOADS_ROW: HomeRow = { id: 'downloads', type: 'downloads', hidden: false };

function defaultRow(kind: ContentKind): HomeRow {
  return { id: kind, type: 'kind', kind, sort: NEWEST_RELEASES, card: 'poster', hidden: false, extra: false };
}

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  version: 2,
  rows: [CONTINUE_ROW, DOWNLOADS_ROW, ...TAB_CONTENT.media.map(defaultRow)],
};

/** A layout from before the Downloaded row has it after Continue, where a new one starts. */
function withDownloads(rows: readonly HomeRow[]): readonly HomeRow[] {
  if (rows.some((row) => row.type === 'downloads')) return rows;
  const at = rows.findIndex((row) => row.type === 'continue') + 1;
  return [...rows.slice(0, at), DOWNLOADS_ROW, ...rows.slice(at)];
}

/** The rows a stored layout holds, brought up to the current version; the defaults for none, or one this app cannot read. */
export function rowsOf(layout: HomeLayout | undefined): readonly HomeRow[] {
  if (layout?.version === 2) return layout.rows;
  if (layout?.version === 1) return withDownloads(layout.rows);
  return DEFAULT_HOME_LAYOUT.rows;
}

/**
 * The rows to show, from whatever was stored. Nothing is stored here: a kind
 * a source newly brings gets its default row, rows nobody feeds are kept but
 * marked unavailable, and anything malformed is repaired.
 */
export function normalizeLayout(
  stored: HomeLayout | undefined,
  kinds: ReadonlySet<ContentKind>,
  canContinue: boolean,
  canKeep: boolean,
): readonly HomeRowView[] {
  const rows: HomeRow[] = [];
  const ids = new Set<string>();
  for (const row of rowsOf(stored)) {
    if (ids.has(row.id)) continue;
    if (row.type === 'kind' && !TAB_CONTENT.media.includes(row.kind)) continue;
    // A row of a type this app does not know is one it cannot draw.
    if (row.type !== 'kind' && row.type !== 'continue' && row.type !== 'downloads') continue;
    ids.add(row.id);
    rows.push(row.type === 'kind' ? { ...row, sort: validSort(row.sort) } : row);
  }
  if (!rows.some((row) => row.type === 'continue')) rows.unshift(CONTINUE_ROW);
  if (!rows.some((row) => row.type === 'downloads')) rows.splice(rows.findIndex((row) => row.type === 'continue') + 1, 0, DOWNLOADS_ROW);
  for (const kind of TAB_CONTENT.media) {
    if (kinds.has(kind) && !rows.some((row) => row.type === 'kind' && row.kind === kind && !row.extra)) {
      rows.push(defaultRow(kind));
    }
  }
  return rows.map((row) => ({
    ...row,
    available: row.type === 'continue' ? canContinue : row.type === 'downloads' ? canKeep : kinds.has(row.kind),
  }));
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

export function setRow(
  rows: readonly HomeRow[],
  id: string,
  change: Partial<Pick<Extract<HomeRow, { type: 'kind' }>, 'sort' | 'card' | 'hidden'>>,
): readonly HomeRow[] {
  return rows.map((row) => {
    if (row.id !== id) return row;
    if (row.type !== 'kind') return change.hidden === undefined ? row : { ...row, hidden: change.hidden };
    return { ...row, ...change };
  });
}

/** An extra row for a kind, newest additions first — a sensible second view of the same library. */
export function addRow(rows: readonly HomeRow[], kind: ContentKind, id: string): readonly HomeRow[] {
  return [
    ...rows,
    { id, type: 'kind', kind, sort: { by: 'addedAt', order: 'desc' }, card: 'poster', hidden: false, extra: true },
  ];
}

export function removeRow(rows: readonly HomeRow[], id: string): readonly HomeRow[] {
  return rows.filter((row) => !(row.id === id && row.type === 'kind' && row.extra));
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
        homeLayout: { version: 2, rows: change(rowsOf(current.homeLayout)) },
      }));
      return rowsOf(next.homeLayout);
    },
    reset: async (userId) => {
      await preferences.update(userId, ({ homeLayout: _discarded, ...rest }) => rest);
      return DEFAULT_HOME_LAYOUT.rows;
    },
  };
}
