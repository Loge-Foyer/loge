import type { TvMenu } from '@/services/ports';

// A page has a browser's back, which is the page's own: nothing to keep.
export const tvMenu: TvMenu = { hold: () => () => undefined, refresh: () => undefined };
