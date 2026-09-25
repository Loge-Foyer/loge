import type { ContentKind } from '@sc/api';

export type ContentTab = 'media' | 'videos';

/**
 * Where each kind of content appears — the only place the app maps kinds to
 * tabs. Media is the library (films, series, anime); Videos is web video and
 * plain files, browsed one source at a time.
 */
export const TAB_CONTENT: Readonly<Record<ContentTab, readonly ContentKind[]>> = {
  media: ['movies', 'shows', 'anime'],
  videos: ['videos', 'files'],
};

/** The kinds out of `kinds` that belong on `tab`, in the tab's order. */
export function kindsForTab(tab: ContentTab, kinds: readonly ContentKind[]): readonly ContentKind[] {
  return TAB_CONTENT[tab].filter((kind) => kinds.includes(kind));
}
