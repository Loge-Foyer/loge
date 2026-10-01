import {
  imageRef,
  type Channel,
  type ChannelGroup,
  type ConnectionId,
  type Episode,
  type GlobalMediaKey,
  type ImageRef,
  type Movie,
  type PlaybackSource,
  type Programme,
  type Season,
  type Show,
} from '@sc/api';

import { record, text } from './portal';

/**
 * Where a portal keeps something: its live section, its films, or a series
 * section of its own. Not every portal has the third — an older one mixes its
 * series into the films — and the two answer different calls for the same
 * thing, so what a series came from travels with it.
 */
export type VodType = 'vod' | 'series';

/**
 * The portal's answers as domain types. Ids carry what they name — `ch:`,
 * `vod:`, `show:`, `season:`, `episode:` — and, for a series, which section it
 * came from, so one call knows what it is asked about. **Every part is
 * encoded**, because a portal's own ids hold colons (`18390:18390`). A `cmd`
 * never goes into an id: on some portals it is the stream's address, sign-in
 * and all.
 */
const part = (value: string) => encodeURIComponent(value);
const of = (from: VodType) => (from === 'series' ? 's' : 'v');

export const ids = {
  channel: (id: string) => `ch:${part(id)}`,
  movie: (id: string) => `vod:${part(id)}`,
  show: (id: string, from: VodType) => `show:${of(from)}:${part(id)}`,
  season: (show: string, season: string, from: VodType) => `season:${of(from)}:${part(show)}:${part(season)}`,
  episode: (show: string, season: string, episode: string, from: VodType) =>
    `episode:${of(from)}:${part(show)}:${part(season)}:${part(episode)}`,
};

export type Parsed =
  | { readonly kind: 'channel'; readonly id: string }
  | { readonly kind: 'movie'; readonly id: string }
  | { readonly kind: 'show'; readonly from: VodType; readonly id: string }
  | { readonly kind: 'season'; readonly from: VodType; readonly show: string; readonly season: string }
  | { readonly kind: 'episode'; readonly from: VodType; readonly show: string; readonly season: string; readonly episode: string };

export function parseId(externalId: string): Parsed | undefined {
  const [kind, ...rest] = externalId.split(':');
  if (kind === 'ch' && rest[0]) return { kind: 'channel', id: decodeURIComponent(rest[0]) };
  if (kind === 'vod' && rest[0]) return { kind: 'movie', id: decodeURIComponent(rest[0]) };
  const from: VodType | undefined = rest[0] === 's' ? 'series' : rest[0] === 'v' ? 'vod' : undefined;
  const [a, b, c] = rest.slice(1).map((value) => decodeURIComponent(value));
  if (!from) return undefined;
  if (kind === 'show' && a) return { kind: 'show', from, id: a };
  if (kind === 'season' && a && b) return { kind: 'season', from, show: a, season: b };
  if (kind === 'episode' && a && b && c) return { kind: 'episode', from, show: a, season: b, episode: c };
  return undefined;
}

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const number = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const yes = (value: unknown) => value === 1 || value === '1' || value === true;

/** Artwork: an address, or a path on the portal. */
export function image(value: unknown, root: string | undefined): ImageRef | undefined {
  const path = text(value);
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return imageRef(path);
  return root ? imageRef(`${root}${path.startsWith('/') ? '' : '/'}${path}`) : undefined;
}

export function toGroups(js: unknown): readonly ChannelGroup[] {
  return list(js).flatMap((entry) => {
    const genre = record(entry);
    const id = text(genre?.id);
    const title = text(genre?.title);
    // "*" is the portal's "All", which is no group of its own.
    return id && title && id !== '*' ? [{ id, name: title }] : [];
  });
}

export interface ChannelRow {
  readonly channel: Channel;
  /** What `create_link` takes. Kept in memory only. */
  readonly cmd?: string;
}

export interface Page<T> {
  readonly rows: readonly T[];
  readonly page: number;
  readonly total?: number;
  readonly perPage?: number;
}

function pageOf<T>(js: unknown, requested: number, map: (entry: Readonly<Record<string, unknown>>) => T | undefined): Page<T> {
  const body = record(js);
  const rows = list(body?.data).flatMap((entry) => {
    const row = record(entry);
    const mapped = row ? map(row) : undefined;
    return mapped ? [mapped] : [];
  });
  const total = number(body?.total_items);
  const perPage = number(body?.max_page_items);
  return { rows, page: number(body?.cur_page) || requested, ...(total === undefined ? {} : { total }), ...(perPage === undefined ? {} : { perPage }) };
}

export function toChannels(js: unknown, requested: number, connectionId: ConnectionId, root: string | undefined): Page<ChannelRow> {
  return pageOf(js, requested, (row) => toChannelRow(row, connectionId, root));
}

export function toChannelRow(row: Readonly<Record<string, unknown>>, connectionId: ConnectionId, root: string | undefined): ChannelRow | undefined {
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return undefined;
  const channelNumber = number(row.number);
  const genre = text(row.tv_genre_id);
  const logo = image(row.logo, root);
  const archiveHours = number(row.tv_archive_duration);
  const cmd = text(row.cmd);
  return {
    channel: {
      key: { connectionId, externalId: ids.channel(id) },
      name,
      ...(channelNumber === undefined ? {} : { number: channelNumber }),
      groupIds: genre ? [genre] : [],
      ...(logo ? { logo } : {}),
      ...(yes(row.archive) && archiveHours ? { catchupDays: Math.max(1, Math.round(archiveHours / 24)) } : {}),
    },
    ...(cmd ? { cmd } : {}),
  };
}

export function toProgramme(entry: unknown, channel: GlobalMediaKey): Programme | undefined {
  const row = record(entry);
  const start = number(row?.start_timestamp);
  const stop = number(row?.stop_timestamp);
  const title = text(row?.name);
  if (!row || start === undefined || stop === undefined || !title || stop <= start) return undefined;
  const description = text(row.descr);
  return {
    channel,
    title,
    ...(description ? { description } : {}),
    startsAt: new Date(start * 1000).toISOString(),
    endsAt: new Date(stop * 1000).toISOString(),
  };
}

/** The programmes `get_epg_info` sends for one channel, keyed by the portal's channel id. */
export function epgInfoFor(js: unknown, channelId: string): readonly unknown[] {
  return list(record(record(js)?.data)?.[channelId]);
}

export function epgList(js: unknown): readonly unknown[] {
  // `get_short_epg` answers a list; some portals wrap it as a page.
  return Array.isArray(js) ? js : list(record(js)?.data);
}

/** `create_link`'s address, without the player hint a MAG box reads first — or why there is none. */
export function linkOf(js: unknown): { readonly url?: string; readonly error?: string } {
  const body = record(js);
  const error = text(body?.error);
  const cmd = text(body?.cmd)?.trim();
  const url = cmd?.replace(/^(ffmpeg|ffrt\d?|auto)\s+/i, '').trim();
  return { ...(url && /^[a-z]+:\/\//i.test(url) ? { url } : {}), ...(error ? { error } : {}) };
}

export function sourceFor(url: string, live: boolean): PlaybackSource {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.m3u8')) return { uri: url, protocol: 'hls', transcoded: false, live };
  const container = path.match(/\.(mp4|mkv|avi|m4v|mov|webm|ts)$/)?.[1];
  // A live link with no extension is a raw MPEG-TS stream on almost every portal.
  if (live || container === 'ts') return { uri: url, protocol: 'mpegts', container: 'ts', transcoded: false, live };
  return { uri: url, protocol: 'progressive', ...(container ? { container } : {}), transcoded: false, live };
}

export interface VodRow {
  readonly item: Movie | Show;
  readonly cmd?: string;
  /** Old portals list a series' episodes by number on the series itself. */
  readonly episodes?: readonly number[];
}

export function toVod(js: unknown, requested: number, connectionId: ConnectionId, root: string | undefined, from: VodType): Page<VodRow> {
  return pageOf(js, requested, (row) => toVodRow(row, connectionId, root, from));
}

function toVodRow(row: Readonly<Record<string, unknown>>, connectionId: ConnectionId, root: string | undefined, from: VodType): VodRow | undefined {
  const id = text(row.id);
  const title = text(row.name);
  if (!id || !title) return undefined;
  const year = number(row.year);
  const minutes = number(row.time);
  const rating = number(row.rating_imdb);
  const overview = text(row.description);
  const poster = image(row.screenshot_uri, root);
  const genres = (text(row.genres_str) ?? '')
    .split(',')
    .map((genre) => genre.trim())
    .filter((genre) => genre !== '' && genre !== 'N/A');
  const common = {
    title,
    ...(text(row.o_name) && text(row.o_name) !== title ? { sortTitle: title } : {}),
    ...(overview ? { overview } : {}),
    ...(year ? { year } : {}),
    ...(minutes ? { runtimeMs: minutes * 60_000 } : {}),
    ratings: rating && rating > 0 ? { community: Math.round(rating * 10) / 10 } : {},
    genres,
    images: poster ? { poster } : {},
  };
  const cmd = text(row.cmd);
  // Everything in a portal's series section is a series, whatever it says.
  if (from === 'series' || yes(row.is_series)) {
    const episodes = list(row.series).flatMap((entry) => {
      const value = number(entry);
      return value === undefined ? [] : [value];
    });
    return {
      item: { ...common, type: 'show', key: { connectionId, externalId: ids.show(id, from) } },
      ...(cmd ? { cmd } : {}),
      ...(episodes.length > 0 ? { episodes } : {}),
    };
  }
  return { item: { ...common, type: 'movie', key: { connectionId, externalId: ids.movie(id) } }, ...(cmd ? { cmd } : {}) };
}

export interface SeasonRow {
  readonly season: Season;
  readonly cmd?: string;
  /** A season that lists its episodes by number rather than as rows of their own. */
  readonly episodes?: readonly number[];
}

export function toSeasons(js: unknown, show: Show, connectionId: ConnectionId): readonly SeasonRow[] {
  const showId = parseId(show.key.externalId);
  if (showId?.kind !== 'show') return [];
  return list(record(js)?.data).flatMap((entry, index) => {
    const row = record(entry);
    const id = text(row?.id);
    if (!row || !id) return [];
    const seasonNumber = number(row.season_number) ?? index + 1;
    const cmd = text(row.cmd);
    const numbered = list(row.series).flatMap((value) => {
      const each = number(value);
      return each === undefined ? [] : [each];
    });
    return [
      {
        season: {
          type: 'season' as const,
          key: { connectionId, externalId: ids.season(showId.id, id, showId.from) },
          title: text(row.name) ?? `Season ${seasonNumber}`,
          show: show.key,
          showTitle: show.title,
          seasonNumber,
          ratings: {},
          genres: [],
          images: {},
        },
        ...(cmd ? { cmd } : {}),
        ...(numbered.length > 0 ? { episodes: numbered } : {}),
      },
    ];
  });
}

export interface EpisodeRow {
  readonly item: Episode;
  readonly cmd?: string;
  /** The episode's number, which old portals put in `create_link`'s `series`. */
  readonly series?: number;
}

export function toEpisodes(js: unknown, season: Season, connectionId: ConnectionId): readonly EpisodeRow[] {
  const at = parseId(season.key.externalId);
  if (at?.kind !== 'season') return [];
  return list(record(js)?.data).flatMap((entry, index) => {
    const row = record(entry);
    const id = text(row?.id);
    if (!row || !id) return [];
    const episodeNumber = number(row.series_number) ?? index + 1;
    const cmd = text(row.cmd);
    return [
      {
        item: {
          type: 'episode' as const,
          key: { connectionId, externalId: ids.episode(at.show, at.season, id, at.from) },
          title: text(row.name) ?? `Episode ${episodeNumber}`,
          show: season.show,
          season: season.key,
          showTitle: season.showTitle ?? '',
          ...(season.seasonNumber === undefined ? {} : { seasonNumber: season.seasonNumber }),
          episodeNumber,
          ratings: {},
          genres: [],
          images: {},
        },
        ...(cmd ? { cmd } : {}),
        series: episodeNumber,
      },
    ];
  });
}
