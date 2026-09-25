/**
 * What a media source brings. A plugin only states which kinds it can supply;
 * where each kind appears is the app's decision.
 */
export const CONTENT_KINDS = ['movies', 'shows', 'anime', 'videos', 'files'] as const;

export type ContentKind = (typeof CONTENT_KINDS)[number];
