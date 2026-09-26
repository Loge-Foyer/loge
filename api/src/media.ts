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

export type MediaItemType = 'movie' | 'show' | 'season' | 'episode';

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
}

export interface MediaRatings {
  /** Audience rating, 0–10. */
  readonly community?: number;
  /** Critics' score, 0–100. */
  readonly critic?: number;
}

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

export interface Season extends MediaItemBase {
  readonly type: 'season';
  readonly show: GlobalMediaKey;
  readonly showTitle?: string;
  readonly seasonNumber?: number;
  readonly episodeCount?: number;
}

export interface Episode extends MediaItemBase {
  readonly type: 'episode';
  readonly show: GlobalMediaKey;
  readonly season?: GlobalMediaKey;
  readonly showTitle: string;
  readonly seasonNumber?: number;
  readonly episodeNumber?: number;
  /** ISO 8601 date. */
  readonly airDate?: string;
}

/** Plain data throughout, so it can be cached, persisted and paged as is. */
export type MediaItem = Movie | Show | Season | Episode;

export type PersonKind = 'actor' | 'director' | 'writer' | 'producer' | 'other';

export interface Person {
  readonly name: string;
  /** The character for an actor, the job otherwise. */
  readonly role?: string;
  readonly kind: PersonKind;
  readonly image?: ImageRef;
}

export interface MediaDetail {
  readonly item: MediaItem;
  readonly tagline?: string;
  readonly people: readonly Person[];
  readonly studios: readonly string[];
  /** Ids in public catalogues, keyed by catalogue: `imdb`, `tmdb`, `tvdb`. */
  readonly externalIds: Readonly<Record<string, string>>;
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
