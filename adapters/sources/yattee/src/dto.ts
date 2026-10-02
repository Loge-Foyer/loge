/**
 * The parts of Yattee Server's payloads this adapter reads, checked on the way
 * in. Everything arrives as `unknown`; nothing shaped like the server leaves
 * the package — `map.ts` turns these into domain types.
 *
 * The shapes are Invidious-compatible, which is what the server promises, so
 * these readers describe that vocabulary rather than yt-dlp's.
 */

type Json = Readonly<Record<string, unknown>>;

export function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // Several Invidious fields are decimal strings — `contentLength` above all.
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `{ key: value }` when the value is there, `{}` otherwise — for optional properties. */
export function present<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: V };
}

export interface ThumbnailDto {
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
}

export interface FormatDto {
  readonly itag?: string;
  readonly url: string;
  /** `video/mp4; codecs="avc1.640028"`. */
  readonly type?: string;
  readonly container?: string;
  readonly encoding?: string;
  /** `1080p`, `medium`, `tiny`. */
  readonly quality?: string;
  readonly qualityLabel?: string;
  readonly resolution?: string;
  readonly bitrate?: number;
  readonly contentLength?: number;
  readonly fps?: number;
  readonly audioQuality?: string;
  readonly audioChannels?: number;
}

export interface CaptionDto {
  readonly label: string;
  readonly languageCode?: string;
  /** Server-relative, with its signing token already on it. */
  readonly url?: string;
}

export interface VideoDto {
  readonly videoId: string;
  readonly title: string;
  readonly description?: string;
  readonly author?: string;
  readonly authorId?: string;
  readonly lengthSeconds?: number;
  readonly published?: number;
  readonly publishedText?: string;
  readonly viewCount?: number;
  readonly isLive?: boolean;
  readonly thumbnails: readonly ThumbnailDto[];
  /** Its channel's face, where the answer carries it — a video's own page does. */
  readonly authorThumbnails: readonly ThumbnailDto[];
  readonly formatStreams: readonly FormatDto[];
  readonly adaptiveFormats: readonly FormatDto[];
  readonly captions: readonly CaptionDto[];
  readonly genre?: string;
}

export interface ChannelDto {
  readonly authorId: string;
  readonly author: string;
  readonly description?: string;
  readonly subCount?: number;
  readonly videoCount?: number;
  readonly thumbnails: readonly ThumbnailDto[];
  /** The wide picture across the top of its page. */
  readonly banners: readonly ThumbnailDto[];
}

export interface PlaylistDto {
  readonly playlistId: string;
  readonly title: string;
  readonly description?: string;
  readonly author?: string;
  readonly authorId?: string;
  readonly videoCount?: number;
  /** A search or a channel's list names one picture for it, where it names no videos. */
  readonly thumbnail?: string;
  readonly videos: readonly VideoDto[];
}

/** One answer of a search, which may mix videos, channels and playlists. */
export type SearchResultDto =
  | { readonly type: 'video'; readonly video: VideoDto }
  | { readonly type: 'channel'; readonly channel: ChannelDto }
  | { readonly type: 'playlist'; readonly playlist: PlaylistDto };

/** One page of a channel's section: its videos — or, for its playlists, those — and where the next page starts. */
export interface ChannelPageDto {
  readonly videos: readonly VideoDto[];
  readonly playlists: readonly PlaylistDto[];
  readonly continuation?: string;
}

export interface InfoDto {
  readonly version?: string;
}

function readThumbnail(value: unknown): ThumbnailDto | undefined {
  const thumb = record(value);
  const url = text(thumb?.url);
  if (!thumb || !url) return undefined;
  return { url, ...present('width', number(thumb.width)), ...present('height', number(thumb.height)) };
}

function readThumbnails(value: unknown): readonly ThumbnailDto[] {
  return list(value).flatMap((entry) => readThumbnail(entry) ?? []);
}

function readFormat(value: unknown): FormatDto | undefined {
  const format = record(value);
  const url = text(format?.url);
  if (!format || !url) return undefined;
  return {
    url,
    // An itag is a number on some payloads and a string on others.
    ...present('itag', text(format.itag) ?? number(format.itag)?.toString()),
    ...present('type', text(format.type)),
    ...present('container', text(format.container)),
    ...present('encoding', text(format.encoding)),
    ...present('quality', text(format.quality)),
    ...present('qualityLabel', text(format.qualityLabel)),
    ...present('resolution', text(format.resolution)),
    ...present('bitrate', number(format.bitrate)),
    ...present('contentLength', number(format.clen) ?? number(format.contentLength) ?? number(format.size)),
    ...present('fps', number(format.fps)),
    ...present('audioQuality', text(format.audioQuality)),
    ...present('audioChannels', number(format.audioChannels)),
  };
}

function readFormats(value: unknown): readonly FormatDto[] {
  return list(value).flatMap((entry) => readFormat(entry) ?? []);
}

function readCaption(value: unknown): CaptionDto | undefined {
  const caption = record(value);
  const label = text(caption?.label);
  if (!caption || !label) return undefined;
  return {
    label,
    ...present('languageCode', text(caption.language_code) ?? text(caption.languageCode)),
    ...present('url', text(caption.url)),
  };
}

export function readVideo(value: unknown): VideoDto | undefined {
  const video = record(value);
  const videoId = text(video?.videoId);
  const title = text(video?.title);
  if (!video || !videoId || !title) return undefined;
  return {
    videoId,
    title,
    ...present('description', text(video.description)),
    ...present('author', text(video.author)),
    ...present('authorId', text(video.authorId)),
    ...present('lengthSeconds', number(video.lengthSeconds)),
    ...present('published', number(video.published)),
    ...present('publishedText', text(video.publishedText)),
    ...present('viewCount', number(video.viewCount)),
    ...present('isLive', video.liveNow === true || video.isLive === true ? true : undefined),
    ...present('genre', text(video.genre)),
    thumbnails: readThumbnails(video.videoThumbnails ?? video.thumbnails),
    authorThumbnails: readThumbnails(video.authorThumbnails),
    formatStreams: readFormats(video.formatStreams),
    adaptiveFormats: readFormats(video.adaptiveFormats),
    captions: list(video.captions).flatMap((entry) => readCaption(entry) ?? []),
  };
}

/** A search or a listing answers with a bare array, or wraps it. */
export function readVideos(value: unknown): readonly VideoDto[] {
  const wrapped = record(value);
  const entries = Array.isArray(value) ? value : list(wrapped?.videos ?? wrapped?.items ?? wrapped?.results);
  return entries.flatMap((entry) => readVideo(entry) ?? []);
}

export function readChannel(value: unknown): ChannelDto | undefined {
  const channel = record(value);
  const authorId = text(channel?.authorId);
  const author = text(channel?.author);
  if (!channel || !authorId || !author) return undefined;
  return {
    authorId,
    author,
    ...present('description', text(channel.description)),
    ...present('subCount', number(channel.subCount)),
    ...present('videoCount', number(channel.videoCount)),
    thumbnails: readThumbnails(channel.authorThumbnails ?? channel.thumbnails),
    banners: readThumbnails(channel.authorBanners),
  };
}

export function readPlaylist(value: unknown): PlaylistDto | undefined {
  const playlist = record(value);
  const playlistId = text(playlist?.playlistId);
  const title = text(playlist?.title);
  if (!playlist || !playlistId || !title) return undefined;
  return {
    playlistId,
    title,
    ...present('description', text(playlist.description)),
    ...present('author', text(playlist.author)),
    ...present('authorId', text(playlist.authorId)),
    ...present('videoCount', number(playlist.videoCount)),
    ...present('thumbnail', text(playlist.playlistThumbnail)),
    videos: list(playlist.videos).flatMap((entry) => readVideo(entry) ?? []),
  };
}

/**
 * A search's answers, each by the `type` it says it is — a video when it says
 * nothing, as the server's own default is. One it cannot read is dropped,
 * never guessed at.
 */
export function readSearchResults(value: unknown): readonly SearchResultDto[] {
  const wrapped = record(value);
  const entries = Array.isArray(value) ? value : list(wrapped?.items ?? wrapped?.results);
  return entries.flatMap((entry): SearchResultDto[] => {
    const type = text(record(entry)?.type) ?? 'video';
    if (type === 'channel') {
      const channel = readChannel(entry);
      return channel ? [{ type: 'channel', channel }] : [];
    }
    if (type === 'playlist') {
      const playlist = readPlaylist(entry);
      return playlist ? [{ type: 'playlist', playlist }] : [];
    }
    const video = type === 'video' ? readVideo(entry) : undefined;
    return video ? [{ type: 'video', video }] : [];
  });
}

/** `/channels/{id}/{section}`: its videos, or its playlists, and the token for the next page. */
export function readChannelPage(value: unknown): ChannelPageDto {
  const page = record(value);
  return {
    videos: list(page?.videos).flatMap((entry) => readVideo(entry) ?? []),
    playlists: list(page?.playlists).flatMap((entry) => readPlaylist(entry) ?? []),
    ...present('continuation', text(page?.continuation)),
  };
}

export function readInfo(value: unknown): InfoDto | undefined {
  const info = record(value);
  if (!info) return undefined;
  return { ...present('version', text(info.version) ?? text(record(info.versions)?.server)) };
}

/** `/health` answers `{"status":"ok"}` and nothing else. */
export function readHealthy(value: unknown): boolean {
  return text(record(value)?.status) === 'ok';
}
