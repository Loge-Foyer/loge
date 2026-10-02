import {
  AppError,
  matchesTerm,
  type CancelSignal,
  type ConnectedMediaProvider,
  type GlobalMediaKey,
  type ItemPage,
  type ItemQuery,
  type ItemSortKey,
  type MediaContext,
  type MediaItem,
  type MediaTarget,
  type PlaybackDescriptor,
  type PlaybackRequest,
  type Programme,
  type Season,
  zoneOffsetMs,
} from '@sc/api';

import {
  epgInfoFor,
  epgList,
  ids,
  linkOf,
  parseId,
  sourceFor,
  toChannels,
  toEpisodes,
  toGroups,
  toProgramme,
  toSeasons,
  toVod,
  type ChannelRow,
  type EpisodeRow,
  type SeasonRow,
  type VodRow,
  type VodType,
} from './map';
import { abandonable, createPortal, isPortalAnswer, unreadable } from './portal';

// Now and next, for a few channels, is one short call each; a longer window is one call for all.
const SHORT_EPG_CHANNELS = 6;
const SHORT_EPG_WINDOW_MS = 6 * 3_600_000;
const LONGEST_GUIDE_HOURS = 48;
const EPISODE_PAGES = 20;
// Every channel, or every channel's guide, in one answer: far more than a page,
// so given the client's longest wait rather than a page's.
const WHOLE_PORTAL_MS = 60_000;
// One answer about the whole portal's guide serves every list that asks within it.
const GUIDE_SLOT_MS = 5 * 60_000;
// Where films and series share pages, how far to read on for one of the kind asked for.
const READ_ON = 3;

// The portal's orders closest to each sort. Its pages come in its own order.
const SORTS: Readonly<Record<ItemSortKey, string>> = { addedAt: 'added', releaseDate: 'added', title: 'name', rating: 'rating' };

export function createProvider(target: MediaTarget, context: MediaContext): ConnectedMediaProvider {
  const { connectionId, fields, settings } = target;
  const portalUrl = typeof fields.portalUrl === 'string' ? fields.portalUrl : '';
  // The zone the portal keeps its guide in, where the connection says; its times as sent otherwise.
  const zone = typeof settings.timeZone === 'string' && settings.timeZone !== '' ? settings.timeZone : undefined;
  const portal = createPortal({ portalUrl, context });
  // What `create_link` takes for each id — in memory only: on some portals it is the stream's address, sign-in and all.
  const channelCmds = new Map<string, string>();
  const vod = new Map<string, VodRow>();
  const seasonRows = new Map<string, SeasonRow>();
  const episodeRows = new Map<string, EpisodeRow>();
  let everyChannel: Promise<void> | undefined;
  // Films and series still being listed. A poster from a saved page can be
  // opened while the portal is still answering after launch, and `getItem`
  // knows only what a listing brought — so it waits for these before it says
  // it does not know something.
  const listings = new Set<Promise<unknown>>();
  const listing = <T>(work: Promise<T>): Promise<T> => {
    listings.add(work);
    return work.finally(() => listings.delete(work));
  };
  // Whether this portal keeps its series apart from its films, once it has said.
  let seriesSection: Promise<boolean> | undefined;
  // The whole portal's guide for a five-minute slot, shared by whoever asks in it.
  let wholeGuide: { readonly slot: number; readonly period: number; readonly answer: Promise<unknown> } | undefined;

  const remember = (rows: readonly ChannelRow[]) => {
    for (const row of rows) if (row.cmd) channelCmds.set(row.channel.key.externalId, row.cmd);
  };

  // A channel played before its list was read, since a restart: the whole list, once.
  const loadEveryChannel = (signal?: CancelSignal) => {
    everyChannel ??= (async () => {
      remember(toChannels(await portal.call('itv', 'get_all_channels', {}, signal, { timeoutMs: WHOLE_PORTAL_MS }), 1, connectionId, portal.root()).rows);
    })().catch((error: unknown) => {
      everyChannel = undefined;
      throw error;
    });
    return everyChannel;
  };

  const own = (key: GlobalMediaKey) => key.connectionId === connectionId;

  /**
   * Whether the portal has a series section of its own. Its categories are the
   * honest question: a portal without one answers nothing, while asking it for
   * a list of series can hand back the films. What the portal answers is kept,
   * a "no such thing" included. A failure to ask it is not: a portal that was
   * slow once, or a list left while it loaded, still has its series — and the
   * one portal seen keeps every series there and none among its films, so
   * taking that failure for "no" emptied Series for the rest of the session.
   */
  const hasSeriesSection = (signal?: CancelSignal) => {
    seriesSection ??= portal.call('series', 'get_categories', {}).then(
      (js) => Array.isArray(js) && js.length > 0,
      (error: unknown) => {
        if (isPortalAnswer(error)) return false;
        seriesSection = undefined;
        throw error;
      },
    );
    return abandonable(seriesSection, signal);
  };

  /** The whole portal's guide, once for a five-minute slot however many lists ask in it. */
  const guideOfEveryChannel = (period: number, signal?: CancelSignal) => {
    const slot = Math.floor(context.clock.now() / GUIDE_SLOT_MS);
    if (!wholeGuide || wholeGuide.slot !== slot || wholeGuide.period < period) {
      // On no caller's signal: one list giving up must not fail the others sharing it.
      const answer = portal.call('itv', 'get_epg_info', { period }, undefined, { timeoutMs: WHOLE_PORTAL_MS });
      const asked = { slot, period, answer };
      wholeGuide = asked;
      answer.catch(() => {
        if (wholeGuide === asked) wholeGuide = undefined;
      });
    }
    return abandonable(wholeGuide.answer, signal);
  };

  const describe = async (request: PlaybackRequest, type: 'itv' | VodType, params: Readonly<Record<string, string | number>>, live: boolean, signal?: CancelSignal): Promise<PlaybackDescriptor> => {
    const link = linkOf(await portal.call(type, 'create_link', { series: '', forced_storage: 'undefined', disable_ad: 0, download: 0, force_ch_link_check: 0, ...params }, signal));
    if (link.error === 'limit') throw new AppError('PROVIDER_UNAVAILABLE', 'Too many devices are watching on this subscription right now.', { retry: 'backoff' });
    if (link.error === 'nothing_to_play') throw new AppError('NOT_FOUND', 'The portal has nothing to play for this.');
    if (link.error) throw new AppError('PROVIDER_UNAVAILABLE', 'The portal could not make a link to play.', { retry: 'backoff' });
    if (!link.url) throw unreadable();
    return {
      key: request.key,
      sources: [sourceFor(link.url, live)],
      audioTracks: [],
      subtitleTracks: [],
      ...(request.startMs === undefined || live ? {} : { startMs: request.startMs }),
    };
  };

  /** Every page of a series' seasons or episodes: a portal pages them like everything else. */
  const allPages = async (from: VodType, params: Readonly<Record<string, string | number>>, signal?: CancelSignal) => {
    const data: unknown[] = [];
    for (let page = 1; page <= EPISODE_PAGES; page += 1) {
      const js = await portal.call(from, 'get_ordered_list', { ...params, p: page }, signal);
      const body = js && typeof js === 'object' && !Array.isArray(js) ? (js as { data?: unknown; total_items?: unknown; max_page_items?: unknown }) : undefined;
      const rows = Array.isArray(body?.data) ? body.data : [];
      data.push(...rows);
      const total = Number(body?.total_items);
      const perPage = Number(body?.max_page_items);
      if (rows.length === 0 || !(total > 0) || !(perPage > 0) || page * perPage >= total) break;
    }
    return { data };
  };

  /** A page of films or series, in the portal's order for the sort. */
  const listVod = async (query: ItemQuery, signal?: CancelSignal): Promise<ItemPage> => {
    if (query.kind !== 'movies' && query.kind !== 'shows') return { items: [] };
    const page = query.cursor ? Number(query.cursor) : 1;
    const wanted = query.kind === 'movies' ? 'movie' : 'show';

    const term = query.term?.trim();
    const ask = async (from: VodType) => {
      // Where films and series share pages, each kind takes its own from them
      // — and a term is checked again here, as the channels are. A page can
      // then hold none of the kind asked for: read on, a few pages at most,
      // rather than answer an empty page that claims more, which a grid pages
      // through one request at a time.
      for (let at = page, read = 1; ; read += 1) {
        const js = await portal.call(
          from,
          'get_ordered_list',
          { category: '*', sortby: SORTS[query.sort.by], fav: 0, hd: 0, not_ended: 0, p: at, ...(term ? { search: term } : {}) },
          signal,
        );
        const result = toVod(js, at, connectionId, portal.root(), from);
        for (const row of result.rows) vod.set(row.item.key.externalId, row);
        const more = result.total !== undefined && result.perPage !== undefined && result.rows.length > 0 && result.page * result.perPage < result.total;
        const items = result.rows.map((row) => row.item).filter((item) => item.type === wanted && (term ? matchesTerm(term, item.title) : true));
        if (items.length > 0 || !more || read >= READ_ON) return { items, ...(more ? { nextCursor: String(result.page + 1) } : {}) };
        at = result.page + 1;
      }
    };

    if (wanted === 'movie') return ask('vod');
    // A portal with a series section of its own keeps every series there,
    // and its films where the films are. An older one has no such section
    // and mixes them, which is what the fall-back reads.
    return (await hasSeriesSection(signal)) ? ask('series') : ask('vod');
  };

  return {
    connectionId,

    check: async (signal) => {
      await portal.check(signal);
      return { serverName: portal.root()?.replace(/^[a-z]+:\/\//i, '') ?? portalUrl };
    },

    listChannelGroups: async (signal) => toGroups(await portal.call('itv', 'get_genres', {}, signal)),

    listChannels: async (query, signal) => {
      const page = query.cursor ? Number(query.cursor) : 1;
      const term = query.term?.trim();
      const js = await portal.call(
        'itv',
        'get_ordered_list',
        { genre: query.groupId ?? '*', fav: 0, sortby: 'number', hd: 0, force_ch_link_check: '', p: page, ...(term ? { search: term } : {}) },
        signal,
      );
      const result = toChannels(js, page, connectionId, portal.root());
      remember(result.rows);
      const more = result.total !== undefined && result.perPage !== undefined && result.rows.length > 0 && result.page * result.perPage < result.total;
      return {
        // Asked of the portal and checked again here: not every portal honours
        // `search`, and one that ignores it would answer with every channel.
        channels: result.rows.map((row) => row.channel).filter((channel) => (term ? matchesTerm(term, channel.name) : true)),
        ...(result.total === undefined ? {} : { total: result.total }),
        ...(more ? { nextCursor: String(result.page + 1) } : {}),
      };
    },

    getGuide: async (query, signal) => {
      const from = Date.parse(query.from);
      const to = Date.parse(query.to);
      const wanted = query.channels.flatMap((key) => {
        const parsed = own(key) ? parseId(key.externalId) : undefined;
        return parsed?.kind === 'channel' ? [{ key, id: parsed.id }] : [];
      });
      if (wanted.length === 0) return [];
      const inWindow = (programme: Programme) => Date.parse(programme.endsAt) > from && Date.parse(programme.startsAt) < to;
      const now = context.clock.now();
      if (wanted.length <= SHORT_EPG_CHANNELS && to - now <= SHORT_EPG_WINDOW_MS) {
        const lists = await Promise.all(
          wanted.map(async ({ key, id }) => epgList(await portal.call('itv', 'get_short_epg', { ch_id: id, size: 10 }, signal)).flatMap((entry) => toProgramme(entry, key, zone) ?? [])),
        );
        return lists.flat().filter(inWindow);
      }
      // The portal counts its hours from its own clock: a guide shifted by its
      // zone needs that many more to reach the end of the window asked for.
      const shift = zone ? Math.ceil(Math.abs(zoneOffsetMs(zone, now) ?? 0) / 3_600_000) : 0;
      const period = Math.min(LONGEST_GUIDE_HOURS, Math.max(1, Math.ceil((to - now) / 3_600_000) + shift));
      const js = await guideOfEveryChannel(period, signal);
      return wanted.flatMap(({ key, id }) => epgInfoFor(js, id).flatMap((entry) => toProgramme(entry, key, zone) ?? [])).filter(inWindow);
    },

    listItems: (query, signal) => listing(listVod(query, signal)),

    getItem: async (externalId) => {
      const known = () => vod.get(externalId) ?? episodeRows.get(externalId);
      if (!known() && listings.size > 0) await Promise.allSettled([...listings]);
      const row = known();
      if (!row) throw new AppError('NOT_FOUND', 'Open it from the portal’s list again.');
      return { item: row.item, people: [], studios: [], externalIds: {} };
    },

    getChildren: async (parent, signal) => {
      const at = parseId(parent.key.externalId);
      if (parent.type === 'show' && at?.kind === 'show') {
        const rows = toSeasons(await allPages(at.from, { movie_id: at.id, season_id: 0, episode_id: 0 }, signal), parent, connectionId);
        for (const row of rows) seasonRows.set(row.season.key.externalId, row);
        if (rows.length > 0) return { items: rows.map((row) => row.season), total: rows.length };
        // An old portal numbers a series' episodes on the series itself: one season holds them.
        const numbered = vod.get(parent.key.externalId)?.episodes;
        if (!numbered) return { items: [] };
        const season: Season = {
          type: 'season',
          key: { connectionId, externalId: ids.season(at.id, '1', at.from) },
          title: 'Season 1',
          show: parent.key,
          showTitle: parent.title,
          seasonNumber: 1,
          ratings: {},
          genres: [],
          images: {},
        };
        return { items: [season], total: 1 };
      }
      if (parent.type === 'season' && at?.kind === 'season') {
        const show = vod.get(ids.show(at.show, at.from));
        // Either the season or the series itself may list the episodes by
        // number instead of as rows: they are played through whichever did,
        // with the number `create_link` asks for.
        const season = seasonRows.get(parent.key.externalId);
        const numbered = season?.episodes ?? (at.season === '1' ? show?.episodes : undefined);
        const cmd = season?.episodes ? season.cmd : show?.cmd;
        const rows: readonly EpisodeRow[] = numbered
          ? numbered.map((number) => ({
              item: {
                type: 'episode' as const,
                key: { connectionId, externalId: ids.episode(at.show, at.season, String(number), at.from) },
                title: `Episode ${number}`,
                show: parent.show,
                season: parent.key,
                showTitle: parent.showTitle ?? '',
                ...(parent.seasonNumber === undefined ? {} : { seasonNumber: parent.seasonNumber }),
                episodeNumber: number,
                ratings: {},
                genres: [],
                images: {},
              },
              ...(cmd ? { cmd } : {}),
              series: number,
            }))
          : toEpisodes(await allPages(at.from, { movie_id: at.show, season_id: at.season, episode_id: 0 }, signal), parent, connectionId);
        for (const row of rows) episodeRows.set(row.item.key.externalId, row);
        const items: readonly MediaItem[] = rows.map((row) => row.item);
        return { items, total: items.length };
      }
      return { items: [] };
    },

    getPlaybackDescriptor: async (request, signal) => {
      const at = own(request.key) ? parseId(request.key.externalId) : undefined;
      if (at?.kind === 'channel') {
        if (!channelCmds.has(request.key.externalId)) await loadEveryChannel(signal);
        const cmd = channelCmds.get(request.key.externalId);
        if (!cmd) throw new AppError('NOT_FOUND', 'The portal no longer has this channel.');
        return describe(request, 'itv', { cmd }, true, signal);
      }
      if (at?.kind === 'movie') {
        const cmd = vod.get(request.key.externalId)?.cmd;
        if (!cmd) throw new AppError('NOT_FOUND', 'Open it from the portal’s list again.');
        return describe(request, 'vod', { cmd }, false, signal);
      }
      if (at?.kind === 'episode') {
        const row = episodeRows.get(request.key.externalId);
        if (!row?.cmd) throw new AppError('NOT_FOUND', 'Open the season again.');
        // Always `vod`: a portal's series section lists, and the films' side
        // makes every link — asking `series` for one answers nothing at all.
        return describe(request, 'vod', { cmd: row.cmd, ...(row.series === undefined ? {} : { series: row.series }) }, false, signal);
      }
      throw new AppError('INVALID_STATE', 'A series plays one episode at a time.');
    },

    resolveImage: (ref) => ({ uri: ref }),

    dispose: async () => {
      channelCmds.clear();
      vod.clear();
      seasonRows.clear();
      episodeRows.clear();
    },
  };
}
