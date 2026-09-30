import {
  AppError,
  compareItems,
  type ConnectedMediaProvider,
  type GlobalMediaKey,
  type MediaContext,
  type MediaItem,
  type MediaTarget,
  type PlaybackSource,
} from '@sc/api';

import { createLineup, guideFor, type LineupSize } from './lineup';
import { channelSource, episodeSource, movieSource } from './streams';

const SLOW_MS = 1_500;

export function createProvider(target: MediaTarget, context: MediaContext): ConnectedMediaProvider {
  const { connectionId, fields, settings } = target;
  const size: LineupSize = fields.lineupSize === 'large' ? 'large' : 'small';
  const lineup = createLineup(connectionId, size);
  const channels = new Map(lineup.channels.map((channel) => [channel.key.externalId, channel]));
  const children = new Map<string, MediaItem>(
    [...lineup.seasons.values(), ...lineup.episodes.values()].flat().map((item) => [item.key.externalId, item]),
  );
  let calls = 0;

  // Latency is simulated where a real portal would be slow or fail: every call.
  const respond = async <T>(answer: () => T): Promise<T> => {
    calls += 1;
    if (settings.latency === 'slow') await context.clock.sleep(SLOW_MS);
    if (settings.latency === 'flaky' && calls % 3 === 0) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'The mock portal is pretending to be down.', { retry: 'backoff' });
    }
    return answer();
  };

  // Another connection's key is not this portal's, however its id reads.
  const own = (key: GlobalMediaKey) => key.connectionId === connectionId;

  const page = <T>(all: readonly T[], limit: number, cursor: string | undefined) => {
    const offset = cursor ? Number(cursor) : 0;
    const slice = all.slice(offset, offset + limit);
    const next = offset + slice.length;
    return { slice, total: all.length, ...(next < all.length ? { nextCursor: String(next) } : {}) };
  };

  const sourceFor = (externalId: string): PlaybackSource => {
    const channel = channels.get(externalId);
    if (channel) return channelSource(channel.number ?? 0, lineup.transportStreamOnly.has(externalId));
    const movie = lineup.movies.findIndex((item) => item.key.externalId === externalId);
    if (movie >= 0) return movieSource(movie);
    const episode = children.get(externalId);
    if (episode?.type === 'episode') return episodeSource(episode.episodeNumber ?? 0);
    throw new AppError('NOT_FOUND', 'The mock portal has nothing to play by that id.');
  };

  return {
    connectionId,

    check: () => respond(() => ({ serverName: 'Mock portal', version: 'mock' })),

    // Films and series; channels are not items, so `live` has none.
    listItems: (query) =>
      respond(() => {
        const all = [...(query.kind === 'movies' ? lineup.movies : query.kind === 'shows' ? lineup.shows : [])].sort(compareItems(query.sort));
        const { slice, ...rest } = page(all, query.limit, query.cursor);
        return { items: slice, ...rest };
      }),

    getItem: (externalId) =>
      respond(() => {
        const detail = lineup.details.get(externalId);
        if (detail) return detail;
        const child = children.get(externalId);
        if (!child) throw new AppError('NOT_FOUND', 'The mock portal has no such title.');
        return { item: child, people: [], studios: [], externalIds: {} };
      }),

    getChildren: (parent) =>
      respond(() => {
        const found: readonly MediaItem[] =
          parent.type === 'show'
            ? (lineup.seasons.get(parent.key.externalId) ?? [])
            : parent.type === 'season'
              ? (lineup.episodes.get(parent.key.externalId) ?? [])
              : [];
        return { items: found, total: found.length };
      }),

    listChannelGroups: () => respond(() => lineup.groups),

    listChannels: (query) =>
      respond(() => {
        const { groupId } = query;
        const all = groupId === undefined ? lineup.channels : lineup.channels.filter((channel) => channel.groupIds.includes(groupId));
        const { slice, ...rest } = page(all, query.limit, query.cursor);
        return { channels: slice, ...rest };
      }),

    getGuide: (query) =>
      respond(() => {
        const from = Date.parse(query.from);
        const to = Date.parse(query.to);
        return query.channels.filter(own).flatMap((key) => {
          const channel = channels.get(key.externalId);
          return channel ? guideFor(channel, from, to) : [];
        });
      }),

    getPlaybackDescriptor: (request) =>
      respond(() => {
        if (!own(request.key)) throw new AppError('NOT_FOUND', 'That is another connection’s.');
        return {
          key: request.key,
          sources: [sourceFor(request.key.externalId)],
          audioTracks: [],
          subtitleTracks: [],
          ...(request.startMs === undefined ? {} : { startMs: request.startMs }),
        };
      }),

    dispose: async () => {},
  };
}
