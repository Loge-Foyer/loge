import type { ContentKind } from '@loge/api';

import type { HomeFilter } from '@/services/home-filter';

export type FilterChip =
  | { readonly type: 'clear' }
  | { readonly type: 'kind'; readonly kind: ContentKind; readonly chosen: boolean }
  | { readonly type: 'categories'; readonly genre?: string };

// Series before films, as the home's own chips have them.
const ORDER: readonly ContentKind[] = ['shows', 'movies', 'anime'];

/** The kinds the home can be narrowed to, of those its sources bring, in the chips' order. */
export const offeredKinds = (kinds: readonly ContentKind[]): readonly ContentKind[] => ORDER.filter((kind) => kinds.includes(kind));

/**
 * The chips over the home: the kinds the sources bring, then Categories.
 * Something chosen puts a ✕ first, which clears it all; a kind chosen stands
 * alone — choosing it again clears it — and a genre chosen names itself where
 * Categories was.
 */
export function chipsFor(filter: HomeFilter, kinds: readonly ContentKind[]): readonly FilterChip[] {
  const offered = offeredKinds(kinds);
  const chosen = filter.kind !== undefined || filter.genre !== undefined;
  const kindChips: FilterChip[] =
    filter.kind === undefined
      ? offered.map((kind) => ({ type: 'kind', kind, chosen: false }))
      : [{ type: 'kind', kind: filter.kind, chosen: true }];
  return [
    ...(chosen ? [{ type: 'clear' } as const] : []),
    ...kindChips,
    filter.genre === undefined ? { type: 'categories' } : { type: 'categories', genre: filter.genre },
  ];
}
