import type { ContentKind, ItemSort, MediaItemType } from '@sc/api';

import type { QueryValue } from './url';

export const ITEM_TYPE: Readonly<Partial<Record<ContentKind, { readonly jellyfin: string; readonly type: MediaItemType }>>> = {
  movies: { jellyfin: 'Movie', type: 'movie' },
  shows: { jellyfin: 'Series', type: 'show' },
};

// Cards need little; the detail page asks for the rest.
export const LIST_FIELDS = ['SortName', 'DateCreated', 'ChildCount', 'RecursiveItemCount'] as const;
export const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  'Overview',
  'Genres',
  'People',
  'Studios',
  'Taglines',
  'ProviderIds',
] as const;
export const IMAGE_TYPES = ['Primary', 'Backdrop', 'Thumb', 'Logo'] as const;

// Each sort's own key, then the title: Jellyfin pairs sortBy and sortOrder by
// position, so there are never more orders than keys.
const SORT_KEYS: Readonly<Record<ItemSort['by'], readonly string[]>> = {
  releaseDate: ['PremiereDate', 'SortName'],
  addedAt: ['DateCreated', 'SortName'],
  title: ['SortName'],
  rating: ['CommunityRating', 'SortName'],
};

export function sortParams(sort: ItemSort): { sortBy: readonly string[]; sortOrder: readonly string[] } {
  const keys = SORT_KEYS[sort.by];
  const direction = sort.order === 'asc' ? 'Ascending' : 'Descending';
  return { sortBy: keys, sortOrder: keys.map((_, index) => (index === 0 ? direction : 'Ascending')) };
}

export function itemsParams(options: {
  readonly userId: string;
  readonly itemType: string;
  readonly sort: ItemSort;
  readonly parentId: string | undefined;
  readonly startIndex: number;
  readonly limit: number;
}): Readonly<Record<string, QueryValue>> {
  const { sortBy, sortOrder } = sortParams(options.sort);
  return {
    userId: options.userId,
    parentId: options.parentId,
    includeItemTypes: options.itemType,
    recursive: true,
    // Otherwise a server setting can swap films for the collections they belong to.
    collapseBoxSetItems: false,
    sortBy,
    sortOrder,
    startIndex: options.startIndex,
    limit: options.limit,
    fields: LIST_FIELDS,
    enableUserData: true,
    imageTypeLimit: 1,
    enableImageTypes: IMAGE_TYPES,
    enableTotalRecordCount: true,
  };
}
