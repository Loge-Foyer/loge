import {
  fromZoneWallClock,
  imageRef,
  zoneOffsetMs,
  plainTitle,
  type ExternalIds,
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
} from '@loge/api';

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

/** A year a portal writes as a year, a date (`1999-03-31`) or "N/A". */
const yearOf = (value: unknown): number | undefined => {
  const digits = typeof value === 'number' ? String(value) : (text(value) ?? '');
  const found = /^(1[89]\d\d|20\d\d)\b/.exec(digits.trim());
  return found ? Number(found[1]) : undefined;
};

/** An id a portal sends as a number or a string — and "", 0 or "N/A" for none. */
const idOf = (value: unknown): string | undefined => {
  const id = typeof value === 'number' ? String(value) : text(value)?.trim();
  return id && id !== '0' && /^[A-Za-z0-9]+$/.test(id) ? id : undefined;
};

/**
 * The catalogues a portal matched a film or series to — TMDB above all, which
 * many fill in — so its copies in other languages and qualities, each a title
 * of its own on the portal, are known as one.
 */
function externalIdsOf(row: Readonly<Record<string, unknown>>): ExternalIds | undefined {
  const tmdb = idOf(row.tmdb_id) ?? idOf(row.tmdb);
  const imdb = idOf(row.imdb_id);
  const kinopoisk = idOf(row.kinopoisk_id);
  const ids = {
    ...(tmdb ? { tmdb } : {}),
    ...(imdb && /^tt\d+$/.test(imdb) ? { imdb } : {}),
    ...(kinopoisk ? { kinopoisk } : {}),
  };
  return Object.keys(ids).length === 0 ? undefined : ids;
}

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
  /** The id its guide has in the portal's XMLTV source — `trt1.tr` — whose ending names its country. */
  readonly guideId?: string;
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
  const guideId = text(row.xmltv_id);
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
    ...(guideId ? { guideId } : {}),
  };
}

/**
 * How one channel's guide is read. `zone` is the time zone the connection
 * says the portal keeps its guide in: a portal that stamps its own wall-clock
 * time as UTC — told the box is on UTC, as this plugin always says — puts
 * 20:15 in Berlin at 20:15Z, two hours late in summer. `countryZone` is the
 * zone of the channel's own country, where something about it says which, and
 * the connection reads other countries' guides as UTC.
 */
export interface GuideReading {
  readonly zone?: string;
  readonly countryZone?: string;
}

/** The portal's own wall-clock time — `time`, `2026-10-04 15:25:00` — read as if it were UTC. */
function wallClock(value: unknown): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text(value) ?? '');
  if (!parts) return undefined;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0);
}

/**
 * One programme. Without a zone, its times as sent.
 *
 * Another country's guide can be written in UTC and taken by the portal for
 * its own clock: on a German portal, Show TV's weekend news at 18:25 in
 * Istanbul (15:25Z) came stamped 13:25Z, its `time` 15:25 — two hours early in
 * summer. A channel whose country's zone keeps another offset than the
 * portal's clock — `time` against the stamp, at that programme — is that
 * case: its `time` is read as UTC. One of the portal's own country, or of none
 * known, stays as sent.
 */
export function toProgramme(entry: unknown, channel: GlobalMediaKey, reading: GuideReading = {}): Programme | undefined {
  const row = record(entry);
  const start = number(row?.start_timestamp);
  const stop = number(row?.stop_timestamp);
  const title = text(row?.name);
  if (!row || start === undefined || stop === undefined || !title || stop <= start) return undefined;
  const description = text(row.descr);
  const { zone, countryZone } = reading;
  const sent = (seconds: number) => (zone ? fromZoneWallClock(seconds * 1000, zone) : seconds * 1000);
  // The portal's wall clock for it: its `time`, else the stamp, where the connection says stamps are one.
  const wall = wallClock(row.time) ?? (zone ? start * 1000 : undefined);
  const own = countryZone !== undefined && wall !== undefined ? zoneOffsetMs(countryZone, sent(start)) : undefined;
  const utc = own !== undefined && wall !== undefined && own !== wall - sent(start);
  const startsAt = utc && wall !== undefined ? wall : sent(start);
  const endsAt = utc && wall !== undefined ? (wallClock(row.time_to) ?? wall + (stop - start) * 1000) : sent(stop);
  return {
    channel,
    title,
    ...(description ? { description } : {}),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
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
  // A date more often than a year, else "N/A" — and then the year the name carries, as "Matrix (1999) DE" does.
  const year = yearOf(row.year) ?? plainTitle(title).year;
  const released = /^\d{4}-\d{2}-\d{2}$/.test(text(row.year) ?? '') ? text(row.year) : undefined;
  // A portal says 1 minute where it does not know.
  const minutes = number(row.time);
  const original = text(row.o_name);
  const externalIds = externalIdsOf(row);
  const rating = number(row.rating_imdb);
  const overview = text(row.description);
  const poster = image(row.screenshot_uri, root);
  const genres = (text(row.genres_str) ?? '')
    .split(',')
    .map((genre) => genre.trim())
    .filter((genre) => genre !== '' && genre !== 'N/A');
  const common = {
    title,
    ...(original && original !== title ? { originalTitle: original } : {}),
    ...(externalIds ? { externalIds } : {}),
    ...(overview ? { overview } : {}),
    ...(year ? { year } : {}),
    ...(released ? { releaseDate: released } : {}),
    ...(minutes && minutes > 1 ? { runtimeMs: minutes * 60_000 } : {}),
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

/**
 * What a season and an episode know of their series: its catalogue ids, its
 * year and original title — so an episode is the same one in every language's
 * copy — and its cover, which a portal's episodes have none of their own.
 */
export function ofShow(show: Pick<Show, 'externalIds' | 'originalTitle' | 'year' | 'images'>) {
  return {
    ...(show.externalIds ? { showExternalIds: show.externalIds } : {}),
    ...(show.originalTitle ? { showOriginalTitle: show.originalTitle } : {}),
    ...(show.year === undefined ? {} : { showYear: show.year }),
    images: show.images.poster ? { poster: show.images.poster } : {},
  };
}

/** The same, handed on from a season to its episodes. */
export function fromSeason(season: Season) {
  return {
    ...(season.showExternalIds ? { showExternalIds: season.showExternalIds } : {}),
    ...(season.showOriginalTitle ? { showOriginalTitle: season.showOriginalTitle } : {}),
    ...(season.showYear === undefined ? {} : { showYear: season.showYear }),
    images: season.images.poster ? { poster: season.images.poster } : {},
  };
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
          ...ofShow(show),
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
          ...fromSeason(season),
        },
        ...(cmd ? { cmd } : {}),
        series: episodeNumber,
      },
    ];
  });
}
