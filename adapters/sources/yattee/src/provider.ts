import {
  AppError,
  headersRef,
  type CancelSignal,
  type ConnectedMediaProvider,
  type ImageRef,
  type ImageSize,
  type ImageSource,
  type ItemPage,
  type ItemSortKey,
  type MediaContext,
  type MediaDetail,
  type MediaTarget,
  type PlaybackDescriptor,
  type PlaybackSource,
  type SubtitleTrack,
} from '@sc/api';

import { createClient } from './client';
import { readChannel, readInfo, readPlaylist, readVideo, readVideos, type FormatDto, type VideoDto } from './dto';
import { unreadable } from './errors';
import { channelToItem, parseId, playlistToItem, toDetail, toItem, toItems } from './map';
import { normalizeBaseUrl } from './url';

/** Every image this adapter resolves needs the same header, so one ref serves them all. */
const AUTH_HEADERS = headersRef('auth');

/** The server's orders closest to each sort. Its pages come in its own order. */
const SORTS: Readonly<Record<ItemSortKey, string>> = {
  addedAt: 'upload_date',
  releaseDate: 'upload_date',
  title: 'relevance',
  rating: 'rating',
};

/** Invidious' thumbnail names, smallest first, and the width each is worth asking for. */
const THUMBNAILS: readonly (readonly [number, string])[] = [
  [120, 'default'],
  [320, 'medium'],
  [480, 'hqdefault'],
  [1280, 'maxres'],
];

/** The avatar sizes the server publishes. */
const AVATARS: readonly number[] = [32, 48, 76, 100, 176, 512];

function nearest(sizes: readonly number[], width: number): number {
  let chosen = sizes[sizes.length - 1] ?? width;
  for (const size of [...sizes].reverse()) {
    if (size >= width) chosen = size;
  }
  return chosen;
}

/**
 * A progressive stream a player can open on its own. `adaptiveFormats` keeps
 * video and audio apart, which needs a manifest no engine here is given, so
 * playback uses `formatStreams` — the muxed ones — and nothing else. That caps
 * what plays at whatever the site muxes, usually 720p; the full-quality route
 * is the server's own muxing proxy, which downloads use.
 */
function playable(video: VideoDto): readonly FormatDto[] {
  return video.formatStreams.filter((format) => format.url !== '');
}

function heightOf(format: FormatDto): number | undefined {
  const label = format.qualityLabel ?? format.resolution ?? format.quality;
  const digits = label?.match(/(\d{3,4})p/);
  return digits?.[1] === undefined ? undefined : Number(digits[1]);
}

/** `video/mp4; codecs="avc1.4d401f, mp4a.40.2"` → container and codecs. */
function codecsOf(format: FormatDto): { container?: string; videoCodec?: string; audioCodecs?: readonly string[] } {
  const container = format.container ?? format.type?.match(/\/(\w+)/)?.[1];
  const listed = format.type?.match(/codecs="([^"]+)"/)?.[1]?.split(/,\s*/) ?? [];
  const video = listed.find((codec) => codec.startsWith('avc1') || codec.startsWith('hvc1') || codec.startsWith('av01'));
  const audio = listed.filter((codec) => codec.startsWith('mp4a') || codec.startsWith('opus') || codec.startsWith('ec-3'));
  const videoCodec =
    video === undefined ? undefined : video.startsWith('avc1') ? 'h264' : video.startsWith('hvc1') ? 'hevc' : 'av1';
  return {
    ...(container === undefined ? {} : { container }),
    ...(videoCodec === undefined ? {} : { videoCodec }),
    ...(audio.length === 0 ? {} : { audioCodecs: audio.map((codec) => (codec.startsWith('mp4a') ? 'aac' : codec)) }),
  };
}

function toSource(format: FormatDto, live: boolean): PlaybackSource {
  const height = heightOf(format);
  return {
    uri: format.url,
    headersRef: AUTH_HEADERS,
    protocol: live ? 'hls' : 'progressive',
    ...codecsOf(format),
    ...(height === undefined ? {} : { height }),
    // Nothing is re-encoded: these are the renditions the site published.
    transcoded: false,
    live,
  };
}

function toSubtitles(video: VideoDto, baseUrl: string): readonly SubtitleTrack[] {
  return video.captions.flatMap((caption, index) =>
    caption.url === undefined
      ? []
      : [
          {
            id: `caption-${index}`,
            label: caption.label,
            ...(caption.languageCode === undefined ? {} : { language: caption.languageCode }),
            format: 'vtt',
            delivery: 'external' as const,
            uri: caption.url.startsWith('http') ? caption.url : baseUrl + caption.url,
          },
        ],
  );
}

export function createProvider(target: MediaTarget, context: MediaContext): ConnectedMediaProvider {
  const { connectionId, fields, settings } = target;
  const baseUrl = normalizeBaseUrl(typeof fields.serverUrl === 'string' ? fields.serverUrl : '');
  const username = typeof fields.username === 'string' ? fields.username : '';
  const proxy = typeof settings.proxyMode === 'string' ? settings.proxyMode : 'relay';
  const region = typeof settings.region === 'string' ? settings.region : 'US';
  const client = createClient({ baseUrl, username, context });

  const videoOf = async (id: string, signal?: CancelSignal): Promise<VideoDto> => {
    const video = readVideo(await client.get(`/api/v1/videos/${encodeURIComponent(id)}`, { proxy_mode: proxy }, signal));
    if (!video) throw unreadable();
    return video;
  };

  return {
    connectionId,

    check: async (signal) => {
      // `/health` is public before setup; `/info` needs the sign-in, so asking
      // for both proves the address and the credentials in one press.
      await client.getOpen('/health', signal);
      const info = readInfo(await client.get('/info', {}, signal));
      return { serverName: 'Yattee Server', ...(info?.version === undefined ? {} : { version: info.version }) };
    },

    listItems: async (query, signal) => {
      if (query.kind !== 'videos') return { items: [] };
      const term = query.term?.trim();
      if (term) {
        const page = query.cursor === undefined ? 1 : Number(query.cursor);
        const videos = readVideos(
          await client.get('/api/v1/search', { q: term, type: 'video', sort: SORTS[query.sort.by], page }, signal),
        );
        const items = toItems(videos, connectionId);
        // The server says nothing about how many pages there are: a full page
        // means there may be another, an empty one ends it.
        return { items, ...(items.length >= query.limit ? { nextCursor: String(page + 1) } : {}) };
      }
      // Trending and popular are each a single page the server curates.
      if (query.cursor !== undefined) return { items: [] };
      const videos = readVideos(await client.get('/api/v1/trending', { region }, signal));
      return { items: toItems(videos, connectionId) };
    },

    getItem: async (externalId, signal): Promise<MediaDetail> => {
      const parsed = parseId(externalId);
      if (parsed.kind === 'channel') {
        const channel = readChannel(await client.get(`/api/v1/channels/${encodeURIComponent(parsed.id)}`, {}, signal));
        if (!channel) throw new AppError('NOT_FOUND', 'The server no longer has this channel.');
        return { item: channelToItem(channel, connectionId), people: [], studios: [], externalIds: {} };
      }
      if (parsed.kind === 'playlist') {
        const playlist = readPlaylist(await client.get(`/api/v1/playlists/${encodeURIComponent(parsed.id)}`, {}, signal));
        if (!playlist) throw new AppError('NOT_FOUND', 'The server no longer has this playlist.');
        return { item: playlistToItem(playlist, connectionId), people: [], studios: [], externalIds: {} };
      }
      return toDetail(await videoOf(parsed.id, signal), connectionId);
    },

    getChildren: async (parent, signal): Promise<ItemPage> => {
      const parsed = parseId(parent.key.externalId);
      if (parsed.kind === 'channel') {
        // `getChildren` is handed no cursor, so this is the first page the
        // server gives and nothing more — its `continuation` token has nowhere
        // to live until the contract carries one.
        const answer = await client.get(`/api/v1/channels/${encodeURIComponent(parsed.id)}/videos`, {}, signal);
        return { items: toItems(readVideos(answer), connectionId) };
      }
      if (parsed.kind === 'playlist') {
        const playlist = readPlaylist(await client.get(`/api/v1/playlists/${encodeURIComponent(parsed.id)}`, {}, signal));
        return { items: playlist ? toItems(playlist.videos, connectionId) : [] };
      }
      // A video has nothing inside it.
      return { items: [] };
    },

    resolveImage: (ref: ImageRef, size: ImageSize): ImageSource | null => {
      const value = String(ref);
      const at = value.indexOf('/');
      const kind = value.slice(0, at);
      const id = value.slice(at + 1);
      if (kind === 'v') {
        const [, name] = THUMBNAILS.find(([width]) => width >= size.width) ?? THUMBNAILS[THUMBNAILS.length - 1] ?? [0, 'medium'];
        return { uri: `${baseUrl}/api/v1/thumbnails/${encodeURIComponent(id)}/${name}.jpg`, headersRef: AUTH_HEADERS };
      }
      if (kind === 'c') {
        return {
          uri: `${baseUrl}/api/v1/channels/${encodeURIComponent(id)}/avatar/${nearest(AVATARS, size.width)}.jpg`,
          headersRef: AUTH_HEADERS,
        };
      }
      return null;
    },

    resolveHeaders: async (ref) => (ref === AUTH_HEADERS ? { Authorization: await client.authorization() } : undefined),

    getPlaybackDescriptor: async (request, signal): Promise<PlaybackDescriptor> => {
      const video = await videoOf(request.key.externalId, signal);
      const live = video.isLive === true;
      const formats = playable(video);
      if (formats.length === 0) {
        throw new AppError('INVALID_STATE', 'The server offered no stream this device can open.', { retry: 'never' });
      }
      // Best first: the tallest the chosen player says it can take.
      const ceiling = request.profile.maxHeight;
      const sorted = [...formats].sort((a, b) => (heightOf(b) ?? 0) - (heightOf(a) ?? 0));
      const allowed = sorted.filter((format) => ceiling === undefined || (heightOf(format) ?? 0) <= ceiling);
      const sources = (allowed.length > 0 ? allowed : sorted).map((format) => toSource(format, live));
      return {
        key: request.key,
        sources,
        audioTracks: [],
        subtitleTracks: toSubtitles(video, baseUrl),
        ...(request.startMs === undefined ? {} : { startMs: request.startMs }),
        ...(video.lengthSeconds === undefined || live ? {} : { durationMs: video.lengthSeconds * 1000 }),
      };
    },

    dispose: async () => {
      // Basic auth keeps no session, so there is nothing to end.
    },
  };
}
