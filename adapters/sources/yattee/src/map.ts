import { imageRef, type ChildSection, type ConnectionId, type MediaDetail, type MediaItem, type Movie, type VideoChannel, type VideoPlaylist } from '@sc/api';

import type { ChannelDto, PlaylistDto, SearchResultDto, ThumbnailDto, VideoDto } from './dto';

/**
 * A video is a `movie`: one playable thing with a page of its own, as against
 * the show/season/episode hierarchy. `MediaItemType` has no `video`, and the
 * app knows what it asked for — the query carries the kind — so the type only
 * has to say what shape the item is, and "a single playable thing" is it.
 */
function present<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: V };
}

/**
 * Artwork this adapter can resolve later: `v/<videoId>`, a channel's face
 * `c/<channelId>` and its banner `b/<channelId>`, a playlist's own picture
 * `p/<playlistId>`.
 */
export function videoImage(video: VideoDto): string | undefined {
  return video.thumbnails.length > 0 ? `v/${video.videoId}` : undefined;
}

export function channelImage(channel: ChannelDto): string | undefined {
  return channel.thumbnails.length > 0 ? `c/${channel.authorId}` : undefined;
}

/** A channel's sections, as the server keeps them: `getChildren` takes their ids. */
export const CHANNEL_SECTIONS: readonly ChildSection[] = [
  { id: 'videos', label: 'Videos' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'streams', label: 'Live' },
  { id: 'playlists', label: 'Playlists' },
];

/** A channel's key: its id, apart from a video's. */
export const channelKey = (connectionId: ConnectionId, authorId: string) => ({ connectionId, externalId: `channel:${authorId}` });

/** The smallest thumbnail at least as wide as asked — sharp, and no larger — else the widest there is. */
export function pickThumbnail(thumbnails: readonly ThumbnailDto[], width: number): ThumbnailDto | undefined {
  const sorted = [...thumbnails].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return sorted.find((thumbnail) => (thumbnail.width ?? 0) >= width) ?? sorted.at(-1);
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
    // Its channel, so the page leads there.
    ...(video.author === undefined || video.authorId === undefined
      ? {}
      : {
          creator: {
            key: channelKey(connectionId, video.authorId),
            name: video.author,
            ...(video.authorThumbnails.length > 0 ? { avatar: imageRef(`c/${video.authorId}`) } : {}),
          },
        }),
  };
}

/**
 * A channel: its face and its banner, how many follow it, and what it says
 * about itself. Its videos, shorts, live streams and playlists are its
 * children, a section at a time (`CHANNEL_SECTIONS`).
 */
export function channelToItem(channel: ChannelDto, connectionId: ConnectionId): VideoChannel {
  const image = channelImage(channel);
  return {
    type: 'channel',
    key: channelKey(connectionId, channel.authorId),
    title: channel.author,
    ...present('overview', channel.description),
    ...present('followers', channel.subCount),
    ...present('videoCount', channel.videoCount),
    ratings: {},
    genres: [],
    images: {
      ...(image === undefined ? {} : { avatar: imageRef(image) }),
      ...(channel.banners.length > 0 ? { backdrop: imageRef(`b/${channel.authorId}`) } : {}),
    },
  };
}

/** A playlist: its first video's picture, else the one the server named for it, and whose list it is. */
export function playlistToItem(playlist: PlaylistDto, connectionId: ConnectionId): VideoPlaylist {
  const first = playlist.videos[0];
  const image = (first && videoImage(first)) ?? (playlist.thumbnail === undefined ? undefined : `p/${playlist.playlistId}`);
  return {
    type: 'playlist',
    key: { connectionId, externalId: `playlist:${playlist.playlistId}` },
    title: playlist.title,
    ...present('overview', playlist.description),
    ...present('videoCount', playlist.videoCount),
    ...(playlist.author === undefined || playlist.authorId === undefined
      ? {}
      : { owner: { key: channelKey(connectionId, playlist.authorId), name: playlist.author } }),
    ratings: {},
    genres: playlist.author === undefined ? [] : [playlist.author],
    images: image === undefined ? {} : { thumb: imageRef(image), backdrop: imageRef(image) },
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

/** A search's answers, each as what it is. */
export function searchToItems(results: readonly SearchResultDto[], connectionId: ConnectionId): readonly MediaItem[] {
  return results.map((result) =>
    result.type === 'channel'
      ? channelToItem(result.channel, connectionId)
      : result.type === 'playlist'
        ? playlistToItem(result.playlist, connectionId)
        : toItem(result.video, connectionId),
  );
}
