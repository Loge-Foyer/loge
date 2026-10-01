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
  readonly thumbnails: readonly ThumbnailDto[];
}

export interface PlaylistDto {
  readonly playlistId: string;
  readonly title: string;
  readonly description?: string;
  readonly author?: string;
  readonly videoCount?: number;
  readonly videos: readonly VideoDto[];
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
    thumbnails: readThumbnails(channel.authorThumbnails ?? channel.thumbnails),
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
    ...present('videoCount', number(playlist.videoCount)),
    videos: list(playlist.videos).flatMap((entry) => readVideo(entry) ?? []),
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
