import { AppError, mergeSorted, type MediaItem } from '@loge/api';

export interface SourcePage {
  readonly items: readonly MediaItem[];
  readonly total?: number;
}

export interface MergedPage {
  readonly items: readonly MediaItem[];
  readonly offsets: readonly number[];
  readonly done: boolean;
  readonly total?: number;
}

/**
 * One page across several libraries, without keeping anything between pages:
 * ask each library for a page from its offset, merge them in order, keep the
 * first `limit`, and move each offset past what that library contributed.
 */
export async function pageAcross(
  parents: readonly (string | undefined)[],
  offsets: readonly number[],
  limit: number,
  compare: (a: MediaItem, b: MediaItem) => number,
  load: (parent: string | undefined, startIndex: number, limit: number) => Promise<SourcePage>,
): Promise<MergedPage> {
  const pages = await Promise.all(parents.map((parent, index) => load(parent, offsets[index] ?? 0, limit)));
  const merged = mergeSorted(
    pages.map((page) => page.items),
    compare,
    limit,
  );
  const used = parents.map(() => 0);
  for (const entry of merged) used[entry.list] = (used[entry.list] ?? 0) + 1;
  const done = pages.every((page, index) => page.items.length < limit && used[index] === page.items.length);
  const totals = pages.map((page) => page.total);
  return {
    items: merged.map((entry) => entry.value),
    offsets: offsets.map((offset, index) => offset + (used[index] ?? 0)),
    done,
    ...(totals.every((total) => total !== undefined)
      ? { total: totals.reduce<number>((sum, total) => sum + (total ?? 0), 0) }
      : {}),
  };
}

interface CursorState {
  readonly v: 1;
  readonly scope: string;
  readonly offsets: readonly number[];
}

export function writeCursor(scope: string, offsets: readonly number[]): string {
  const state: CursorState = { v: 1, scope, offsets };
  return JSON.stringify(state);
}

/**
 * The offsets a cursor carries. A cursor made for another set of libraries
 * cannot be continued: starting over would repeat what the list already shows.
 */
export function readCursor(cursor: string | undefined, scope: string, count: number): readonly number[] {
  if (cursor === undefined) return Array.from({ length: count }, () => 0);
  let state: unknown;
  try {
    state = JSON.parse(cursor);
  } catch {
    state = undefined;
  }
  const { v, scope: made, offsets } = (typeof state === 'object' && state !== null ? state : {}) as {
    v?: unknown;
    scope?: unknown;
    offsets?: unknown;
  };
  if (
    v === 1 &&
    made === scope &&
    Array.isArray(offsets) &&
    offsets.length === count &&
    offsets.every((offset) => typeof offset === 'number' && offset >= 0)
  ) {
    return offsets as readonly number[];
  }
  throw new AppError('INVALID_STATE', 'This list changed; start again from the top.', { retry: 'never' });
}
