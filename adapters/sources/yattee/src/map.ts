import { imageRef, type ConnectionId, type MediaDetail, type MediaItem, type Movie } from '@sc/api';

import type { ChannelDto, PlaylistDto, ThumbnailDto, VideoDto } from './dto';

/**
 * A video is a `movie`: one playable thing with a page of its own, as against
 * the show/season/episode hierarchy. `MediaItemType` has no `video`, and the
 * app knows what it asked for — the query carries the kind — so the type only
 * has to say what shape the item is, and "a single playable thing" is it.
 */
function present<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: V };
}

/** Artwork this adapter can resolve later: `v/<videoId>` or `c/<channelId>`. */
export function videoImage(video: VideoDto): string | undefined {
  return video.thumbnails.length > 0 ? `v/${video.videoId}` : undefined;
}

export function channelImage(channel: ChannelDto): string | undefined {
  return channel.thumbnails.length > 0 ? `c/${channel.authorId}` : undefined;
}

/** The widest thumbnail no larger than `width`, else the smallest there is. */
export function pickThumbnail(thumbnails: readonly ThumbnailDto[], width: number): ThumbnailDto | undefined {
  const sorted = [...thumbnails].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  let chosen: ThumbnailDto | undefined;
  for (const thumbnail of sorted) {
    if ((thumbnail.width ?? 0) <= width) chosen = thumbnail;
  }
  return chosen ?? sorted[0];
}

/** Seconds since the epoch, as the ISO date the domain uses. */
function isoDate(seconds: number | undefined): string | undefined {
  if (seconds === undefined || seconds <= 0) return undefined;
  const iso = new Date(seconds * 1000).toISOString();
  return iso.slice(0, 10);
}

export function toItem(video: VideoDto, connectionId: ConnectionId): Movie {
  const image = videoImage(video);
  const released = isoDate(video.published);
  return {
    type: 'movie',
    key: { connectionId, externalId: video.videoId },
    title: video.title,
    ...present('overview', video.description),
    ...present('releaseDate', released),
    ...present('year', released === undefined ? undefined : Number(released.slice(0, 4))),
    ...present('runtimeMs', video.lengthSeconds === undefined ? undefined : video.lengthSeconds * 1000),
    ratings: {},
    // The channel is the one label a web video reliably has, and it is what
    // someone scans a row for.
    genres: video.author === undefined ? [] : [video.author],
    images: image === undefined ? {} : { thumb: imageRef(image), backdrop: imageRef(image) },
  };
}

export function toItems(videos: readonly VideoDto[], connectionId: ConnectionId): readonly MediaItem[] {
  return videos.map((video) => toItem(video, connectionId));
}

export function toDetail(video: VideoDto, connectionId: ConnectionId): MediaDetail {
  return {
    item: toItem(video, connectionId),
    people: video.author === undefined ? [] : [{ name: video.author, kind: 'other', role: 'Channel' }],
    studios: video.author === undefined ? [] : [video.author],
    // The site's own id, so a later feature can reach the original page.
    externalIds: { youtube: video.videoId },
  };
}

/**
 * A channel and a playlist both browse as a `show`: a thing you open to find
 * the videos inside it. `getChildren` answers with those videos.
 */
export function channelToItem(channel: ChannelDto, connectionId: ConnectionId): MediaItem {
  const image = channelImage(channel);
  return {
    type: 'show',
    key: { connectionId, externalId: `channel:${channel.authorId}` },
    title: channel.author,
    ...present('overview', channel.description),
    ratings: {},
    genres: [],
    images: image === undefined ? {} : { poster: imageRef(image), thumb: imageRef(image) },
  };
}

export function playlistToItem(playlist: PlaylistDto, connectionId: ConnectionId): MediaItem {
  const first = playlist.videos[0];
  const image = first && videoImage(first);
  return {
    type: 'show',
    key: { connectionId, externalId: `playlist:${playlist.playlistId}` },
    title: playlist.title,
    ...present('overview', playlist.description),
    ...present('episodeCount', playlist.videoCount),
    ratings: {},
    genres: playlist.author === undefined ? [] : [playlist.author],
    images: image === undefined ? {} : { poster: imageRef(image), thumb: imageRef(image) },
  };
}

/** `channel:UC…` and `playlist:PL…` keep a browsable id apart from a video's. */
export function parseId(externalId: string): { readonly kind: 'video' | 'channel' | 'playlist'; readonly id: string } {
  const at = externalId.indexOf(':');
  if (at < 0) return { kind: 'video', id: externalId };
  const prefix = externalId.slice(0, at);
  const id = externalId.slice(at + 1);
  if (prefix === 'channel') return { kind: 'channel', id };
  if (prefix === 'playlist') return { kind: 'playlist', id };
  return { kind: 'video', id: externalId };
}
