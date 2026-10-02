import type { ContentKind, PluginCategory } from '@loge/api';

export type ContentTab = 'media' | 'videos' | 'tv';

export const CONTENT_TABS: readonly ContentTab[] = ['media', 'videos', 'tv'];

type ShowingCategory = Extract<PluginCategory, 'sources' | 'iptv'>;

/**
 * Where content appears — the only place the app maps a plugin's category and
 * kinds to tabs. A source's films, series and anime are the library, on Media;
 * its web video and plain files are on Videos, one source at a time; its live
 * channels are on TV. Everything an IPTV provider brings stays on TV, its films
 * and series beside its channels: Media and Videos never show IPTV.
 */
const PLACEMENT: Readonly<Record<ShowingCategory, Readonly<Record<ContentTab, readonly ContentKind[]>>>> = {
  sources: { media: ['movies', 'shows', 'anime'], videos: ['videos', 'files'], tv: ['live'] },
  iptv: { media: [], videos: [], tv: ['live', 'movies', 'shows'] },
};

/** Every kind a tab shows, from any category, in the tab's order. */
export const TAB_CONTENT: Readonly<Record<ContentTab, readonly ContentKind[]>> = {
  media: ['movies', 'shows', 'anime'],
  videos: ['videos', 'files'],
  tv: ['live', 'movies', 'shows'],
};

/**
 * The kinds out of `kinds` that a plugin of `category` shows on `tab`, in the
 * tab's order. Players and sync plugins show nothing anywhere.
 */
export function kindsForTab(tab: ContentTab, category: PluginCategory | undefined, kinds: readonly ContentKind[]): readonly ContentKind[] {
  if (category !== 'sources' && category !== 'iptv') return [];
  return PLACEMENT[category][tab].filter((kind) => kinds.includes(kind));
}

/** Whether a plugin of `category` bringing `kinds` shows anything on `tab`. */
export function showsOn(tab: ContentTab, category: PluginCategory | undefined, kinds: readonly ContentKind[]): boolean {
  return kindsForTab(tab, category, kinds).length > 0;
}

/**
 * The tab something plays from, for choosing its player: a channel is on TV,
 * and so is everything an IPTV provider brings; a source's films and series
 * are on Media. (Videos joins when a source brings videos or files to play.)
 */
export function tabOfPlaying(category: PluginCategory | undefined, live: boolean): ContentTab {
  return live || category === 'iptv' ? 'tv' : 'media';
}
