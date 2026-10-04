import type { Href } from 'expo-router';

import { fromRouteId, routeId } from '@/components/media/item-link';
import type { HomeFilter } from '@/services/home-filter';
import { TAB_CONTENT } from '@/services/tab-content';

/** A row's grid, narrowed as the home was when it was opened. The genre goes as an id would: it may hold anything. */
export function browseHref(rowId: string, filter: HomeFilter): Href {
  return {
    pathname: '/browse/[rowId]',
    params: { rowId, ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.genre ? { genre: routeId(filter.genre) } : {}) },
  };
}

/** The filter a grid's address carries, read with care: a kind Media does not show is none. */
export function filterOf(params: { readonly kind?: string; readonly genre?: string }): HomeFilter {
  const kind = TAB_CONTENT.media.find((each) => each === params.kind);
  return { ...(kind ? { kind } : {}), ...(params.genre ? { genre: fromRouteId(params.genre) } : {}) };
}

/** Media's search: every kind the tab shows. */
export const SEARCH_HREF: Href = '/media/search';
