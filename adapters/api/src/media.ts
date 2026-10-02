import type { Brand } from './brand';
import type { ContentKind } from './content';
import type { ConnectionId } from './ids';

/**
 * A media reference, qualified by the connection it came from: two servers —
 * even two connections to one plugin — can use the same id for different things.
 */
export interface GlobalMediaKey {
  readonly connectionId: ConnectionId;
  readonly externalId: string;
}

/** Artwork only its plugin can turn into an address (`resolveImage`). Safe to store. */
export type ImageRef = Brand<string, 'ImageRef'>;

/** Headers an image needs, resolved in memory at load time — never stored, never logged. */
export type HeadersRef = Brand<string, 'HeadersRef'>;

export const imageRef = (value: string): ImageRef => value as ImageRef;
export const headersRef = (value: string): HeadersRef => value as HeadersRef;

/**
 * The shape of an item. A web video is a `movie`: one playable thing with a
 * page of its own. A `channel` and a `playlist` are what a video site keeps
 * its videos in — opened to find them, never played as one.
 */
export type MediaItemType = 'movie' | 'show' | 'season' | 'episode' | 'channel' | 'playlist';

export interface MediaImages {
  /** Portrait, 2:3. */
  readonly poster?: ImageRef;
  /** Wide scene art, 16:9. */
  readonly backdrop?: ImageRef;
  /** A landscape still — an episode's own image. */
  readonly thumb?: ImageRef;
  readonly logo?: ImageRef;
  /** A frame at the resume position, where the source can show one. */
  readonly frame?: ImageRef;
  /** Square, and drawn round: a channel's face. */
  readonly avatar?: ImageRef;
}

export interface MediaRatings {
  /** Audience rating, 0–10. */
  readonly community?: number;
  /** Critics' score, 0–100. */
  readonly critic?: number;
}

/**
 * Ids in public catalogues, keyed by catalogue — `tmdb`, `imdb`, `tvdb`,
 * `kinopoisk`, and a video site's own (`youtube`) — as the source states them.
 */
export type ExternalIds = Readonly<Record<string, string>>;

/**
 * Watch status as the source reports it. The source is its master: the app
 * keeps a cache of it and never treats it as its own record.
 */
export interface WatchStatus {
  readonly played: boolean;
  /** Where playback stopped, for an item in progress. */
  readonly positionMs?: number;
  /** 0–1: minutes watched for a movie or episode, episodes watched for a show or season. */
  readonly progress?: number;
  /** Episodes not yet watched, for a show or season. */
  readonly unplayedCount?: number;
  /** ISO 8601. */
  readonly lastPlayedAt?: string;
  readonly favorite?: boolean;
}

interface MediaItemBase {
  readonly key: GlobalMediaKey;
  readonly title: string;
  /**
   * Where the source says: what makes it the same thing on another source, or
   * in another language's copy — a profile's watch state follows these.
   */
  readonly externalIds?: ExternalIds;
  /** Its title in its own language, where the source gives a translated one. */
  readonly originalTitle?: string;
  readonly sortTitle?: string;
  readonly overview?: string;
  readonly year?: number;
  /** ISO 8601 date: the premiere, first air date or release. */
  readonly releaseDate?: string;
  /** ISO 8601: when the source added it. */
  readonly addedAt?: string;
  readonly runtimeMs?: number;
  /** The age rating as the source states it, such as "PG-13". */
  readonly contentRating?: string;
  readonly ratings: MediaRatings;
  readonly genres: readonly string[];
  readonly images: MediaImages;
  readonly watch?: WatchStatus;
}

export interface Movie extends MediaItemBase {
  readonly type: 'movie';
}

export interface Show extends MediaItemBase {
  readonly type: 'show';
  readonly status?: 'continuing' | 'ended' | 'upcoming';
  readonly endYear?: number;
  readonly seasonCount?: number;
  readonly episodeCount?: number;
}

/** What an episode and a season know of their show, so either is known by it on another source. */
interface OfShow {
  readonly showExternalIds?: ExternalIds;
  readonly showOriginalTitle?: string;
  readonly showYear?: number;
}

export interface Season extends MediaItemBase, OfShow {
  readonly type: 'season';
  readonly show: GlobalMediaKey;
  readonly showTitle?: string;
  readonly seasonNumber?: number;
  readonly episodeCount?: number;
}

export interface Episode extends MediaItemBase, OfShow {
  readonly type: 'episode';
  readonly show: GlobalMediaKey;
  readonly season?: GlobalMediaKey;
  readonly showTitle: string;
  readonly seasonNumber?: number;
  readonly episodeNumber?: number;
  /** ISO 8601 date. */
  readonly airDate?: string;
}

/**
 * Someone's channel on a video site. Not a show: it has no seasons, and what
 * it holds comes in sections — its videos, shorts, live streams and playlists
 * (`MediaDetail.sections`). Its banner is `images.backdrop`, its face
 * `images.avatar`.
 */
export interface VideoChannel extends MediaItemBase {
  readonly type: 'channel';
  /** How many follow it, where the site says. */
  readonly followers?: number;
  readonly videoCount?: number;
}

/** A list of videos someone keeps on a video site. Its children are the videos, in its own order. */
export interface VideoPlaylist extends MediaItemBase {
  readonly type: 'playlist';
  readonly videoCount?: number;
  /** The channel whose list it is, where the site says. */
  readonly owner?: { readonly key: GlobalMediaKey; readonly name: string };
}

/** Plain data throughout, so it can be cached, persisted and paged as is. */
export type MediaItem = Movie | Show | Season | Episode | VideoChannel | VideoPlaylist;

/** One of the sections an item keeps its children in: a channel's videos, shorts, live streams or playlists. */
export interface ChildSection {
  /** The source's own name for it, handed back in `ChildQuery.section`. */
  readonly id: string;
  readonly label: string;
}

/** The channel behind a video, so its page can lead there. */
export interface Creator {
  readonly key: GlobalMediaKey;
  readonly name: string;
  readonly avatar?: ImageRef;
  readonly followers?: number;
}

export type PersonKind = 'actor' | 'director' | 'writer' | 'producer' | 'other';

export interface Person {
  readonly name: string;
  /** The character for an actor, the job otherwise. */
  readonly role?: string;
  readonly kind: PersonKind;
  readonly image?: ImageRef;
}

/**
 * What a picture carries beyond its resolution. Lives here rather than in
 * `playback.ts` because a detail page says it long before anything plays, and
 * `playback.ts` already depends on this module.
 */
export type HdrFormat = 'hdr10' | 'hdr10+' | 'hlg' | 'dolby-vision';

/**
 * Sound placed in a room rather than in channels. Named rather than inferred:
 * Atmos rides inside E-AC-3 and TrueHD alike, and DTS:X inside DTS-HD, so a
 * codec can never say which — only a source that reports it outright can.
 */
export type SpatialAudio = 'dolby-atmos' | 'dts-x' | 'other';

/** How a subtitle reaches the picture. */
export type SubtitleDelivery = 'embedded' | 'external' | 'burned';

export interface VideoStreamInfo {
  /** Lower-case — `h264`, `hevc`, `av1`, `vp9`. */
  readonly codec?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  /** 8 or 10, where the source knows. 10 is what an HDR picture needs. */
  readonly bitDepth?: number;
  readonly hdr?: HdrFormat;
  /** Bits per second. */
  readonly bitrate?: number;
  /** The codec's own profile, as the source names it: `Main 10`, `High`. */
  readonly profile?: string;
}

export interface AudioStreamInfo {
  /** Lower-case — `aac`, `eac3`, `truehd`, `dts`. */
  readonly codec?: string;
  /** BCP 47 where the source gives one. */
  readonly language?: string;
  /** What the source calls this track, in its own words. */
  readonly label?: string;
  readonly channels?: number;
  /** `5.1`, `7.1`, `stereo` — as the source names it. */
  readonly channelLayout?: string;
  readonly bitrate?: number;
  /** Set only where the source names it; absent is "not said", not "no". */
  readonly spatial?: SpatialAudio;
  readonly default?: boolean;
}

export interface SubtitleStreamInfo {
  /** Lower-case — `srt`, `vtt`, `ass`, `pgs`. */
  readonly format?: string;
  readonly language?: string;
  readonly label?: string;
  readonly forced?: boolean;
  readonly delivery: SubtitleDelivery;
}

/**
 * One file behind an item, as the source describes it — a server may hold
 * several of the same film. It is description, not a way to play: a
 * `PlaybackDescriptor` is still what playing asks for, and still lives in
 * memory only. Nothing here can reach a stream.
 */
export interface MediaVersion {
  /** The source's own id for this file, opaque above the adapter. */
  readonly id: string;
  /** What the source calls it, where it has several: `Director's Cut`, `1080p`. */
  readonly label?: string;
  /** Lower-case — `mkv`, `mp4`, `ts`. */
  readonly container?: string;
  readonly sizeBytes?: number;
  readonly durationMs?: number;
  /** The whole file's bitrate, bits per second. */
  readonly bitrate?: number;
  readonly video?: VideoStreamInfo;
  readonly audio: readonly AudioStreamInfo[];
  readonly subtitles: readonly SubtitleStreamInfo[];
}

export interface MediaDetail {
  readonly item: MediaItem;
  readonly tagline?: string;
  readonly people: readonly Person[];
  readonly studios: readonly string[];
  /**
   * The files behind this item, where the source reports them. Absent means
   * the source does not say — not that there are none — so a screen shows
   * nothing rather than guessing. `browse` already promises `getItem`; this is
   * optional data on its answer, not a capability of its own.
   */
  readonly versions?: readonly MediaVersion[];
  /** Who made it, where the source says: a video's channel. Absent is "not said". */
  readonly creator?: Creator;
  /**
   * The sections its children come in, in order — a channel's tabs. Absent:
   * one list, which `getChildren` answers without a section.
   */
  readonly sections?: readonly ChildSection[];
}

export interface Library {
  readonly id: string;
  readonly name: string;
  /** What the library holds, as far as the source can tell. */
  readonly kinds: readonly ContentKind[];
}

/** One part of an image, such as a tile of a sprite sheet, in the image's own pixels. */
export interface ImageCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The whole image's size, so the part can be placed when scaled. */
  readonly sheetWidth: number;
  readonly sheetHeight: number;
}

/** Where to fetch one image right now. Build it when rendering; never store it. */
export interface ImageSource {
  readonly uri: string;
  readonly headersRef?: HeadersRef;
  readonly blurhash?: string;
  readonly crop?: ImageCrop;
}
