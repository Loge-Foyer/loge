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
  type MediaVersion,
  type PlaybackDescriptor,
  type PlaybackSource,
  type SubtitleTrack,
} from '@sc/api';

import { createClient } from './client';
import {
  readChannel,
  readChannelPage,
  readInfo,
  readPlaylist,
  readSearchResults,
  readVideo,
  readVideos,
  type ChannelDto,
  type FormatDto,
  type PlaylistDto,
  type ThumbnailDto,
  type VideoDto,
} from './dto';
import { unreadable } from './errors';
import { CHANNEL_SECTIONS, channelToItem, parseId, pickThumbnail, playlistToItem, searchToItems, toDetail, toItems } from './map';
import { normalizeBaseUrl, queryString } from './url';

/** Every request to the server takes the same header, so one ref serves them all. */
const AUTH_HEADERS = headersRef('auth');

/** The server's orders closest to each sort. Its pages come in its own order. */
const SORTS: Readonly<Record<ItemSortKey, string>> = {
  addedAt: 'upload_date',
  releaseDate: 'upload_date',
  title: 'relevance',
  rating: 'rating',
};

/** `scheme://host:port`, lower-cased: what decides whether an address is the server's own. */
function originOf(url: string): string | undefined {
  return url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i)?.[0]?.toLowerCase();
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

/**
 * The renditions as versions of the same video — which is what they are: one
 * upload, several encodes. Deduped by height, tallest first, so a detail page
 * lists a handful rather than every itag. `adaptiveFormats` is included here
 * even though it cannot be played as it stands, because this is description:
 * it is what the site holds, and what a download can ask the server to mux.
 */
function toVersions(video: VideoDto): readonly MediaVersion[] {
  const byHeight = new Map<number, MediaVersion>();
  for (const format of [...video.formatStreams, ...video.adaptiveFormats]) {
    const height = heightOf(format);
    // An audio-only rendition has no height, and is not a version of the video.
    if (height === undefined || byHeight.has(height)) continue;
    const { container, videoCodec, audioCodecs } = codecsOf(format);
    byHeight.set(height, {
      id: format.itag ?? String(height),
      label: format.qualityLabel ?? `${height}p`,
      ...(container === undefined ? {} : { container }),
      ...(format.contentLength === undefined ? {} : { sizeBytes: format.contentLength }),
      ...(format.bitrate === undefined ? {} : { bitrate: format.bitrate }),
      ...(video.lengthSeconds === undefined ? {} : { durationMs: video.lengthSeconds * 1000 }),
      video: {
        ...(videoCodec === undefined ? {} : { codec: videoCodec }),
        height,
        ...(format.fps === undefined ? {} : { frameRate: format.fps }),
      },
      audio: (audioCodecs ?? []).map((codec) => ({ codec })),
      subtitles: video.captions.map((caption) => ({
        format: 'vtt',
        ...(caption.languageCode === undefined ? {} : { language: caption.languageCode }),
        label: caption.label,
        delivery: 'external' as const,
      })),
    });
  }
  return [...byHeight.values()].sort((a, b) => (b.video?.height ?? 0) - (a.video?.height ?? 0));
}

/**
 * A yt-dlp format selector for the height asked for. The `[ext=…]` preferences
 * push the merge towards an MP4 rather than a Matroska; the bare `best…`
 * fallbacks are what runs when the site published no such pair.
 */
function selector(maxHeight: number | undefined): string {
  const cap = maxHeight === undefined ? '' : `[height<=${maxHeight}]`;
  return `bestvideo${cap}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${cap}+bestaudio/best${cap}`;
}

export function createProvider(target: MediaTarget, context: MediaContext): ConnectedMediaProvider {
  const { connectionId, fields, settings } = target;
  const baseUrl = normalizeBaseUrl(typeof fields.serverUrl === 'string' ? fields.serverUrl : '');
  const username = typeof fields.username === 'string' ? fields.username : '';
  const proxy = typeof settings.proxyMode === 'string' ? settings.proxyMode : 'relay';
  const region = typeof settings.region === 'string' ? settings.region : 'US';
  const client = createClient({ baseUrl, username, context });

  // What the server said each picture is, from its own answers. Its proxy
  // checks no Basic sign-in on a thumbnail: it wants the token it signed into
  // each address, for that video and a day. So the addresses live here, in
  // memory, and a ref — which saved lists and kept copies hold — names only
  // the video or the channel.
  const thumbnails = new Map<string, readonly ThumbnailDto[]>();
  const avatars = new Map<string, readonly ThumbnailDto[]>();
  const banners = new Map<string, readonly ThumbnailDto[]>();
  const covers = new Map<string, readonly ThumbnailDto[]>();
  const seen = (videos: readonly VideoDto[]) => {
    for (const video of videos) {
      if (video.thumbnails.length > 0) thumbnails.set(video.videoId, video.thumbnails);
      if (video.authorId !== undefined && video.authorThumbnails.length > 0) avatars.set(video.authorId, video.authorThumbnails);
    }
    return videos;
  };
  const seenChannel = (channel: ChannelDto) => {
    if (channel.thumbnails.length > 0) avatars.set(channel.authorId, channel.thumbnails);
    if (channel.banners.length > 0) banners.set(channel.authorId, channel.banners);
    return channel;
  };
  const seenPlaylist = (playlist: PlaylistDto) => {
    seen(playlist.videos);
    if (playlist.thumbnail !== undefined) covers.set(playlist.playlistId, [{ url: playlist.thumbnail }]);
    return playlist;
  };
  // What each search has answered so far, so a page that brings nothing new
  // ends it: the server says nothing about how many pages there are, and its
  // page is its own size, whatever `limit` asked for.
  const searches = new Map<string, Set<string>>();
  const absolute = (url: string) => (url.startsWith('//') ? `https:${url}` : /^[a-z]+:\/\//i.test(url) ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`);

  const videoOf = async (id: string, signal?: CancelSignal): Promise<VideoDto> => {
    const video = readVideo(await client.get(`/api/v1/videos/${encodeURIComponent(id)}`, { proxy_mode: proxy }, signal));
    if (!video) throw unreadable();
    seen([video]);
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
        // Absent, a search answers with what the kind holds — videos — as it always did.
        const type = query.scope ?? 'video';
        const results = readSearchResults(
          await client.get('/api/v1/search', { q: term, type, sort: SORTS[query.sort.by], page }, signal),
        );
        for (const result of results) {
          if (result.type === 'video') seen([result.video]);
          else if (result.type === 'channel') seenChannel(result.channel);
          else seenPlaylist(result.playlist);
        }
        const asked = `${type}\n${term}`;
        if (page === 1) searches.set(asked, new Set());
        const known = searches.get(asked) ?? new Set<string>();
        const items = searchToItems(results, connectionId).filter((item) => !known.has(item.key.externalId));
        for (const item of items) known.add(item.key.externalId);
        // Another page while this one brought something new; a page of what
        // was already shown, or of nothing, ends it.
        return { items, ...(items.length > 0 ? { nextCursor: String(page + 1) } : {}) };
      }
      // Trending and popular are each a single page the server curates.
      if (query.cursor !== undefined) return { items: [] };
      const videos = readVideos(await client.get('/api/v1/trending', { region }, signal));
      return { items: toItems(seen(videos), connectionId) };
    },

    getItem: async (externalId, signal): Promise<MediaDetail> => {
      const parsed = parseId(externalId);
      if (parsed.kind === 'channel') {
        const channel = readChannel(await client.get(`/api/v1/channels/${encodeURIComponent(parsed.id)}`, {}, signal));
        if (!channel) throw new AppError('NOT_FOUND', 'The server no longer has this channel.');
        seenChannel(channel);
        return { item: channelToItem(channel, connectionId), people: [], studios: [], externalIds: {}, sections: CHANNEL_SECTIONS };
      }
      if (parsed.kind === 'playlist') {
        const playlist = readPlaylist(await client.get(`/api/v1/playlists/${encodeURIComponent(parsed.id)}`, {}, signal));
        if (!playlist) throw new AppError('NOT_FOUND', 'The server no longer has this playlist.');
        seenPlaylist(playlist);
        return { item: playlistToItem(playlist, connectionId), people: [], studios: [], externalIds: {} };
      }
      const video = await videoOf(parsed.id, signal);
      const versions = toVersions(video);
      return { ...toDetail(video, connectionId), ...(versions.length === 0 ? {} : { versions }) };
    },

    getChildren: async (parent, signal, query): Promise<ItemPage> => {
      const parsed = parseId(parent.key.externalId);
      if (parsed.kind === 'channel') {
        // A section the channel does not have is its videos, which every channel has.
        const section = CHANNEL_SECTIONS.find((each) => each.id === query?.section)?.id ?? 'videos';
        const page = readChannelPage(
          await client.get(
            `/api/v1/channels/${encodeURIComponent(parsed.id)}/${section}`,
            query?.cursor === undefined ? {} : { continuation: query.cursor },
            signal,
          ),
        );
        const items =
          section === 'playlists'
            ? page.playlists.map((playlist) => playlistToItem(seenPlaylist(playlist), connectionId))
            : toItems(seen(page.videos), connectionId);
        // The server's own token for the page after this one, handed back as it came.
        return { items, ...(page.continuation === undefined || items.length === 0 ? {} : { nextCursor: page.continuation }) };
      }
      if (parsed.kind === 'playlist') {
        // One answer holds the whole list: the server pages none.
        const playlist = readPlaylist(await client.get(`/api/v1/playlists/${encodeURIComponent(parsed.id)}`, {}, signal));
        return { items: playlist ? toItems(seenPlaylist(playlist).videos, connectionId) : [] };
      }
      // A video has nothing inside it.
      return { items: [] };
    },

    /**
     * The address the server gave for the picture, the size asked for: its own
     * proxy's, signed — or the site's CDN, where the server is set not to
     * proxy pictures. Only the server's own address is sent the sign-in;
     * another host never sees it. A picture no answer has named yet draws its
     * plate, until one does.
     */
    resolveImage: (ref: ImageRef, size: ImageSize): ImageSource | null => {
      const value = String(ref);
      const at = value.indexOf('/');
      const kind = value.slice(0, at);
      const id = value.slice(at + 1);
      const known =
        kind === 'v' ? thumbnails.get(id) : kind === 'c' ? avatars.get(id) : kind === 'b' ? banners.get(id) : kind === 'p' ? covers.get(id) : undefined;
      const chosen = known && pickThumbnail(known, size.width);
      if (!chosen) return null;
      const uri = absolute(chosen.url);
      return originOf(uri) === originOf(baseUrl) ? { uri, headersRef: AUTH_HEADERS } : { uri };
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

    listFeed: async (externalIds, query, signal) => {
      if (externalIds.length === 0) return { items: [] };
      const page = query.cursor === undefined ? 0 : Number(query.cursor);
      // The server keeps no subscription list of its own: the channels come
      // from the profile, on every call.
      const answer = await client.post(
        '/api/v1/feed',
        { channels: [...externalIds], limit: query.limit, offset: page * query.limit },
        signal,
      );
      const items = toItems(seen(readVideos(answer)), connectionId);
      return { items, ...(items.length >= query.limit ? { nextCursor: String(page + 1) } : {}) };
    },

    listDownloadOptions: async (key, signal) => {
      const video = await videoOf(key.externalId, signal);
      // The renditions the site published. Nothing is re-encoded for any of
      // them: the server fetches and muxes what already exists.
      return toVersions(video).map((version) => ({
        id: version.id,
        ...(version.label === undefined ? {} : { label: version.label }),
        ...(version.video?.height === undefined ? {} : { height: version.video.height }),
        ...(version.bitrate === undefined ? {} : { bitrate: version.bitrate }),
        ...(version.sizeBytes === undefined ? {} : { estimatedBytes: version.sizeBytes }),
        // What `/proxy/fast/` produces when it merges, not what the rendition
        // alone is: the audio is a second stream, and the two become one file.
        container: 'mp4',
        ...(version.video?.codec === undefined ? {} : { videoCodec: version.video.codec }),
        ...(version.audio.length === 0
          ? {}
          : { audioCodecs: version.audio.flatMap((track) => (track.codec === undefined ? [] : [track.codec])) }),
        transcoded: false,
      }));
    },

    getDownloadDescriptor: async (request, signal) => {
      const video = await videoOf(request.key.externalId, signal);
      const versions = toVersions(video);
      const chosen = versions.find((version) => version.id === request.optionId) ?? versions[0];
      const ceiling = chosen?.video?.height ?? request.quality?.maxHeight;
      if (versions.length === 0) {
        throw new AppError('INVALID_STATE', 'The server offered nothing to keep.', { retry: 'never' });
      }
      return {
        key: request.key,
        // `/proxy/fast/` runs yt-dlp and streams the file out as it goes, so
        // the separate video and audio renditions arrive as one file — the
        // full-quality route playback cannot take, because it has no manifest
        // and no Range.
        uri:
          `${baseUrl}/proxy/fast/${encodeURIComponent(request.key.externalId)}` +
          queryString({ format: selector(ceiling) }),
        headersRef: AUTH_HEADERS,
        container: 'mp4',
        ...(chosen?.video?.codec === undefined ? {} : { videoCodec: chosen.video.codec }),
        ...(chosen && chosen.audio.length > 0
          ? { audioCodecs: chosen.audio.flatMap((track) => (track.codec === undefined ? [] : [track.codec])) }
          : {}),
        ...(ceiling === undefined ? {} : { height: ceiling }),
        transcoded: false,
        ...(chosen?.sizeBytes === undefined ? {} : { expectedBytes: chosen.sizeBytes }),
        ...(video.lengthSeconds === undefined ? {} : { durationMs: video.lengthSeconds * 1000 }),
        subtitles: video.captions.flatMap((caption, index) =>
          caption.url === undefined
            ? []
            : [
                {
                  id: `caption-${index}`,
                  uri: caption.url.startsWith('http') ? caption.url : baseUrl + caption.url,
                  headersRef: AUTH_HEADERS,
                  format: 'vtt',
                  ...(caption.languageCode === undefined ? {} : { language: caption.languageCode }),
                  label: caption.label,
                  delivery: 'external' as const,
                },
              ],
        ),
      };
    },

    dispose: async () => {
      // Basic auth keeps no session, so there is nothing to end.
    },
  };
}
