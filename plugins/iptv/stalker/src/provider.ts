import {
  AppError,
  type CancelSignal,
  type ConnectedMediaProvider,
  type GlobalMediaKey,
  type ItemSortKey,
  type MediaContext,
  type MediaItem,
  type MediaTarget,
  type PlaybackDescriptor,
  type PlaybackRequest,
  type Programme,
  type Season,
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
  type VodRow,
} from './map';
import { createPortal, unreadable } from './portal';

// Now and next, for a few channels, is one short call each; a longer window is one call for all.
const SHORT_EPG_CHANNELS = 6;
const SHORT_EPG_WINDOW_MS = 6 * 3_600_000;
const LONGEST_GUIDE_HOURS = 48;
const EPISODE_PAGES = 20;

// The portal's orders closest to each sort. Its pages come in its own order.
const SORTS: Readonly<Record<ItemSortKey, string>> = { addedAt: 'added', releaseDate: 'added', title: 'name', rating: 'rating' };

export function createProvider(target: MediaTarget, context: MediaContext): ConnectedMediaProvider {
  const { connectionId, fields } = target;
  const portalUrl = typeof fields.portalUrl === 'string' ? fields.portalUrl : '';
  const portal = createPortal({ portalUrl, context });
  // What `create_link` takes for each id — in memory only: on some portals it is the stream's address, sign-in and all.
  const channelCmds = new Map<string, string>();
  const vod = new Map<string, VodRow>();
  const episodeRows = new Map<string, EpisodeRow>();
  let everyChannel: Promise<void> | undefined;

  const remember = (rows: readonly ChannelRow[]) => {
    for (const row of rows) if (row.cmd) channelCmds.set(row.channel.key.externalId, row.cmd);
  };

  // A channel played before its list was read, since a restart: the whole list, once.
  const loadEveryChannel = (signal?: CancelSignal) => {
    everyChannel ??= (async () => {
      remember(toChannels(await portal.call('itv', 'get_all_channels', {}, signal), 1, connectionId, portal.root()).rows);
    })().catch((error: unknown) => {
      everyChannel = undefined;
      throw error;
    });
    return everyChannel;
  };

  const own = (key: GlobalMediaKey) => key.connectionId === connectionId;

  const describe = async (request: PlaybackRequest, type: 'itv' | 'vod', params: Readonly<Record<string, string | number>>, live: boolean, signal?: CancelSignal): Promise<PlaybackDescriptor> => {
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
  const allPages = async (params: Readonly<Record<string, string | number>>, signal?: CancelSignal) => {
    const data: unknown[] = [];
    for (let page = 1; page <= EPISODE_PAGES; page += 1) {
      const js = await portal.call('vod', 'get_ordered_list', { ...params, p: page }, signal);
      const body = js && typeof js === 'object' && !Array.isArray(js) ? (js as { data?: unknown; total_items?: unknown; max_page_items?: unknown }) : undefined;
      const rows = Array.isArray(body?.data) ? body.data : [];
      data.push(...rows);
      const total = Number(body?.total_items);
      const perPage = Number(body?.max_page_items);
      if (rows.length === 0 || !(total > 0) || !(perPage > 0) || page * perPage >= total) break;
    }
    return { data };
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
      const js = await portal.call('itv', 'get_ordered_list', { genre: query.groupId ?? '*', fav: 0, sortby: 'number', hd: 0, force_ch_link_check: '', p: page }, signal);
      const result = toChannels(js, page, connectionId, portal.root());
      remember(result.rows);
      const more = result.total !== undefined && result.perPage !== undefined && result.rows.length > 0 && result.page * result.perPage < result.total;
      return {
        channels: result.rows.map((row) => row.channel),
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
          wanted.map(async ({ key, id }) => epgList(await portal.call('itv', 'get_short_epg', { ch_id: id, size: 10 }, signal)).flatMap((entry) => toProgramme(entry, key) ?? [])),
        );
        return lists.flat().filter(inWindow);
      }
      const period = Math.min(LONGEST_GUIDE_HOURS, Math.max(1, Math.ceil((to - now) / 3_600_000)));
      const js = await portal.call('itv', 'get_epg_info', { period }, signal);
      return wanted.flatMap(({ key, id }) => epgInfoFor(js, id).flatMap((entry) => toProgramme(entry, key) ?? [])).filter(inWindow);
    },

    listItems: async (query, signal) => {
      if (query.kind !== 'movies' && query.kind !== 'shows') return { items: [] };
      const page = query.cursor ? Number(query.cursor) : 1;
      const js = await portal.call('vod', 'get_ordered_list', { category: '*', sortby: SORTS[query.sort.by], fav: 0, hd: 0, not_ended: 0, p: page }, signal);
      const result = toVod(js, page, connectionId, portal.root());
      for (const row of result.rows) vod.set(row.item.key.externalId, row);
      const more = result.total !== undefined && result.perPage !== undefined && result.rows.length > 0 && result.page * result.perPage < result.total;
      // Films and series share the portal's pages; each kind takes its own from them.
      const type = query.kind === 'movies' ? 'movie' : 'show';
      return { items: result.rows.map((row) => row.item).filter((item) => item.type === type), ...(more ? { nextCursor: String(result.page + 1) } : {}) };
    },

    getItem: async (externalId) => {
      const row = vod.get(externalId) ?? episodeRows.get(externalId);
      if (!row) throw new AppError('NOT_FOUND', 'Open it from the portal’s list again.');
      return { item: row.item, people: [], studios: [], externalIds: {} };
    },

    getChildren: async (parent, signal) => {
      const at = parseId(parent.key.externalId);
      if (parent.type === 'show' && at?.kind === 'show') {
        const seasons = toSeasons(await allPages({ movie_id: at.id, season_id: 0, episode_id: 0 }, signal), parent, connectionId);
        if (seasons.length > 0) return { items: seasons, total: seasons.length };
        // An old portal numbers a series' episodes on the series itself: one season holds them.
        const numbered = vod.get(parent.key.externalId)?.episodes;
        if (!numbered) return { items: [] };
        const season: Season = {
          type: 'season',
          key: { connectionId, externalId: ids.season(at.id, '1') },
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
        const show = vod.get(ids.show(at.show));
        const rows: readonly EpisodeRow[] =
          show?.episodes && at.season === '1'
            ? show.episodes.map((number) => ({
                item: {
                  type: 'episode' as const,
                  key: { connectionId, externalId: ids.episode(at.show, '1', String(number)) },
                  title: `Episode ${number}`,
                  show: parent.show,
                  season: parent.key,
                  showTitle: parent.showTitle ?? '',
                  seasonNumber: 1,
                  episodeNumber: number,
                  ratings: {},
                  genres: [],
                  images: {},
                },
                ...(show.cmd ? { cmd: show.cmd } : {}),
                series: number,
              }))
            : toEpisodes(await allPages({ movie_id: at.show, season_id: at.season, episode_id: 0 }, signal), parent, connectionId);
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
        return describe(request, 'vod', { cmd: row.cmd, ...(row.series === undefined ? {} : { series: row.series }) }, false, signal);
      }
      throw new AppError('INVALID_STATE', 'A series plays one episode at a time.');
    },

    resolveImage: (ref) => ({ uri: ref }),

    dispose: async () => {
      channelCmds.clear();
      vod.clear();
      episodeRows.clear();
    },
  };
}
