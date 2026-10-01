/**
 * The few parts of Jellyfin's payloads this plugin reads, checked on the way
 * in. Everything arrives as `unknown`; nothing shaped like Jellyfin leaves the
 * package — `map.ts` turns these into domain types.
 */

type Json = Readonly<Record<string, unknown>>;

export function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function texts(value: unknown): readonly string[] {
  return list(value).flatMap((entry) => (typeof entry === 'string' ? [entry] : []));
}

function stringMap(value: unknown): Readonly<Record<string, string>> {
  const entries = Object.entries(record(value) ?? {}).flatMap(([key, entry]) =>
    typeof entry === 'string' ? [[key, entry] as const] : [],
  );
  return Object.fromEntries(entries);
}

export interface UserDataDto {
  readonly played: boolean;
  readonly positionTicks?: number;
  readonly playedPercentage?: number;
  readonly unplayedItemCount?: number;
  readonly lastPlayedDate?: string;
  readonly isFavorite?: boolean;
}

export interface PersonDto {
  readonly id?: string;
  readonly name: string;
  readonly role?: string;
  readonly type?: string;
  readonly primaryImageTag?: string;
}

export interface TrickplayInfoDto {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly thumbnailCount: number;
  readonly interval: number;
}

export interface ItemDto {
  readonly id: string;
  /** Only present when `fields` asked for them — the detail page does. */
  readonly mediaSources: readonly MediaSourceDto[];
  readonly type?: string;
  readonly name?: string;
  readonly sortName?: string;
  readonly overview?: string;
  readonly productionYear?: number;
  readonly premiereDate?: string;
  readonly endDate?: string;
  readonly dateCreated?: string;
  readonly runTimeTicks?: number;
  readonly officialRating?: string;
  readonly communityRating?: number;
  readonly criticRating?: number;
  readonly status?: string;
  readonly collectionType?: string;
  readonly taglines: readonly string[];
  readonly genres: readonly string[];
  readonly studios: readonly string[];
  readonly people: readonly PersonDto[];
  readonly providerIds: Readonly<Record<string, string>>;
  readonly imageTags: Readonly<Record<string, string>>;
  readonly backdropImageTags: readonly string[];
  /** Image type → tag → blurhash. */
  readonly imageBlurHashes: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly parentBackdropItemId?: string;
  readonly parentBackdropImageTags: readonly string[];
  readonly parentThumbItemId?: string;
  readonly parentThumbImageTag?: string;
  readonly parentLogoItemId?: string;
  readonly parentLogoImageTag?: string;
  readonly seriesId?: string;
  readonly seriesName?: string;
  readonly seriesPrimaryImageTag?: string;
  readonly seasonId?: string;
  readonly indexNumber?: number;
  readonly parentIndexNumber?: number;
  readonly childCount?: number;
  readonly recursiveItemCount?: number;
  readonly userData?: UserDataDto;
  /** Media source id → width → tile layout. */
  readonly trickplay: Readonly<Record<string, Readonly<Record<string, TrickplayInfoDto>>>>;
}

export function readItem(value: unknown): ItemDto | undefined {
  const item = record(value);
  const id = text(item?.Id);
  if (!item || !id) return undefined;
  return {
    id,
    mediaSources: list(item.MediaSources).flatMap((source) => readMediaSource(source) ?? []),
    ...present('type', text(item.Type)),
    ...present('name', text(item.Name)),
    ...present('sortName', text(item.SortName)),
    ...present('overview', text(item.Overview)),
    ...present('productionYear', number(item.ProductionYear)),
    ...present('premiereDate', text(item.PremiereDate)),
    ...present('endDate', text(item.EndDate)),
    ...present('dateCreated', text(item.DateCreated)),
    ...present('runTimeTicks', number(item.RunTimeTicks)),
    ...present('officialRating', text(item.OfficialRating)),
    ...present('communityRating', number(item.CommunityRating)),
    ...present('criticRating', number(item.CriticRating)),
    ...present('status', text(item.Status)),
    ...present('collectionType', text(item.CollectionType)),
    ...present('parentBackdropItemId', text(item.ParentBackdropItemId)),
    ...present('parentThumbItemId', text(item.ParentThumbItemId)),
    ...present('parentThumbImageTag', text(item.ParentThumbImageTag)),
    ...present('parentLogoItemId', text(item.ParentLogoItemId)),
    ...present('parentLogoImageTag', text(item.ParentLogoImageTag)),
    ...present('seriesId', text(item.SeriesId)),
    ...present('seriesName', text(item.SeriesName)),
    ...present('seriesPrimaryImageTag', text(item.SeriesPrimaryImageTag)),
    ...present('seasonId', text(item.SeasonId)),
    ...present('indexNumber', number(item.IndexNumber)),
    ...present('parentIndexNumber', number(item.ParentIndexNumber)),
    ...present('childCount', number(item.ChildCount)),
    ...present('recursiveItemCount', number(item.RecursiveItemCount)),
    ...present('userData', readUserData(item.UserData)),
    taglines: texts(item.Taglines),
    genres: texts(item.Genres),
    studios: list(item.Studios).flatMap((studio) => {
      const name = text(record(studio)?.Name);
      return name ? [name] : [];
    }),
    people: list(item.People).flatMap((person) => readPerson(person) ?? []),
    providerIds: stringMap(item.ProviderIds),
    imageTags: stringMap(item.ImageTags),
    backdropImageTags: texts(item.BackdropImageTags),
    imageBlurHashes: Object.fromEntries(
      Object.entries(record(item.ImageBlurHashes) ?? {}).map(([type, hashes]) => [type, stringMap(hashes)]),
    ),
    parentBackdropImageTags: texts(item.ParentBackdropImageTags),
    trickplay: readTrickplay(item.Trickplay),
  };
}

/** `{ key: value }` when the value is there, `{}` otherwise — for optional properties. */
function present<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: V };
}

function readUserData(value: unknown): UserDataDto | undefined {
  const data = record(value);
  if (!data) return undefined;
  const positionTicks = number(data.PlaybackPositionTicks);
  const playedPercentage = number(data.PlayedPercentage);
  const unplayedItemCount = number(data.UnplayedItemCount);
  const lastPlayedDate = text(data.LastPlayedDate);
  const isFavorite = boolean(data.IsFavorite);
  return {
    played: data.Played === true,
    ...(positionTicks === undefined ? {} : { positionTicks }),
    ...(playedPercentage === undefined ? {} : { playedPercentage }),
    ...(unplayedItemCount === undefined ? {} : { unplayedItemCount }),
    ...(lastPlayedDate === undefined ? {} : { lastPlayedDate }),
    ...(isFavorite === undefined ? {} : { isFavorite }),
  };
}

function readPerson(value: unknown): PersonDto | undefined {
  const person = record(value);
  const name = text(person?.Name);
  if (!person || !name) return undefined;
  const id = text(person.Id);
  const role = text(person.Role);
  const type = text(person.Type);
  const primaryImageTag = text(person.PrimaryImageTag);
  return {
    name,
    ...(id ? { id } : {}),
    ...(role ? { role } : {}),
    ...(type ? { type } : {}),
    ...(primaryImageTag ? { primaryImageTag } : {}),
  };
}

function readTrickplay(value: unknown): ItemDto['trickplay'] {
  const sources: Record<string, Record<string, TrickplayInfoDto>> = {};
  for (const [sourceId, widths] of Object.entries(record(value) ?? {})) {
    for (const [width, info] of Object.entries(record(widths) ?? {})) {
      const layout = readTrickplayInfo(info);
      if (layout) (sources[sourceId] ??= {})[width] = layout;
    }
  }
  return sources;
}

function readTrickplayInfo(value: unknown): TrickplayInfoDto | undefined {
  const info = record(value);
  const width = positive(info?.Width);
  const height = positive(info?.Height);
  const tileWidth = positive(info?.TileWidth);
  const tileHeight = positive(info?.TileHeight);
  const thumbnailCount = positive(info?.ThumbnailCount);
  const interval = positive(info?.Interval);
  if (!width || !height || !tileWidth || !tileHeight || !thumbnailCount || !interval) return undefined;
  return { width, height, tileWidth, tileHeight, thumbnailCount, interval };
}

function positive(value: unknown): number | undefined {
  const read = number(value);
  return read !== undefined && read > 0 ? read : undefined;
}

export interface ItemsPageDto {
  readonly items: readonly ItemDto[];
  readonly totalRecordCount?: number;
}

/** A `QueryResult` of items, or a bare array, which some endpoints return. */
export function readItemsPage(value: unknown): ItemsPageDto | undefined {
  if (Array.isArray(value)) return { items: value.flatMap((entry) => readItem(entry) ?? []) };
  const page = record(value);
  if (!page || !Array.isArray(page.Items)) return undefined;
  const totalRecordCount = number(page.TotalRecordCount);
  return {
    items: page.Items.flatMap((entry) => readItem(entry) ?? []),
    ...(totalRecordCount === undefined ? {} : { totalRecordCount }),
  };
}

export interface AuthenticationDto {
  readonly accessToken: string;
  readonly userId: string;
}

export function readAuthentication(value: unknown): AuthenticationDto | undefined {
  const result = record(value);
  const accessToken = text(result?.AccessToken);
  const userId = text(record(result?.User)?.Id);
  return accessToken && userId ? { accessToken, userId } : undefined;
}

export interface PublicInfoDto {
  readonly serverName?: string;
  readonly version?: string;
}

export function readPublicInfo(value: unknown): PublicInfoDto | undefined {
  const info = record(value);
  if (!info) return undefined;
  const serverName = text(info.ServerName);
  const version = text(info.Version);
  return { ...(serverName ? { serverName } : {}), ...(version ? { version } : {}) };
}

export function readUserId(value: unknown): string | undefined {
  return text(record(value)?.Id);
}

export interface MediaStreamDto {
  readonly index: number;
  /** `Video`, `Audio`, `Subtitle`, … */
  readonly type: string;
  readonly codec?: string;
  readonly language?: string;
  readonly displayTitle?: string;
  readonly title?: string;
  readonly isDefault: boolean;
  readonly isForced: boolean;
  readonly isExternal: boolean;
  readonly channels?: number;
  readonly channelLayout?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bitDepth?: number;
  readonly bitRate?: number;
  readonly averageFrameRate?: number;
  readonly profile?: string;
  /** `DolbyDigitalPlus`, `DolbyAtmos`, `DTSX`, `None` — Jellyfin 10.9 and later. */
  readonly audioSpatialFormat?: string;
  readonly videoRangeType?: string;
  /** How a subtitle reaches the player: `Embed`, `Hls`, `External`, `Encode` or `Drop`. */
  readonly deliveryMethod?: string;
  readonly deliveryUrl?: string;
}

export interface MediaSourceDto {
  readonly id: string;
  /** What the server calls this file where an item has several. */
  readonly name?: string;
  /** ffprobe's names, sometimes several: `mov,mp4,m4a,3gp,3g2,mj2`. */
  readonly container?: string;
  readonly size?: number;
  readonly bitrate?: number;
  readonly eTag?: string;
  readonly supportsDirectPlay: boolean;
  readonly supportsDirectStream: boolean;
  /** The server's own address for a transcode, token and play session included. */
  readonly transcodingUrl?: string;
  readonly transcodingSubProtocol?: string;
  readonly transcodingContainer?: string;
  readonly runTimeTicks?: number;
  readonly defaultAudioStreamIndex?: number;
  readonly defaultSubtitleStreamIndex?: number;
  readonly mediaStreams: readonly MediaStreamDto[];
}

export interface PlaybackInfoDto {
  readonly playSessionId?: string;
  /** `NotAllowed`, `NoCompatibleStream` or `RateLimitExceeded`. */
  readonly errorCode?: string;
  readonly mediaSources: readonly MediaSourceDto[];
}

export function readPlaybackInfo(value: unknown): PlaybackInfoDto | undefined {
  const info = record(value);
  if (!info) return undefined;
  return {
    ...present('playSessionId', text(info.PlaySessionId)),
    ...present('errorCode', text(info.ErrorCode)),
    mediaSources: list(info.MediaSources).flatMap((source) => readMediaSource(source) ?? []),
  };
}

export function readMediaSource(value: unknown): MediaSourceDto | undefined {
  const source = record(value);
  const id = text(source?.Id);
  if (!source || !id) return undefined;
  return {
    id,
    ...present('name', text(source.Name)),
    ...present('container', text(source.Container)),
    ...present('size', number(source.Size)),
    ...present('bitrate', number(source.Bitrate)),
    ...present('eTag', text(source.ETag)),
    supportsDirectPlay: source.SupportsDirectPlay === true,
    supportsDirectStream: source.SupportsDirectStream === true,
    ...present('transcodingUrl', text(source.TranscodingUrl)),
    ...present('transcodingSubProtocol', text(source.TranscodingSubProtocol)),
    ...present('transcodingContainer', text(source.TranscodingContainer)),
    ...present('runTimeTicks', number(source.RunTimeTicks)),
    ...present('defaultAudioStreamIndex', number(source.DefaultAudioStreamIndex)),
    ...present('defaultSubtitleStreamIndex', number(source.DefaultSubtitleStreamIndex)),
    mediaStreams: list(source.MediaStreams).flatMap((stream) => readMediaStream(stream) ?? []),
  };
}

function readMediaStream(value: unknown): MediaStreamDto | undefined {
  const stream = record(value);
  const index = number(stream?.Index);
  const type = text(stream?.Type);
  if (!stream || index === undefined || !type) return undefined;
  return {
    index,
    type,
    ...present('codec', text(stream.Codec)),
    ...present('language', text(stream.Language)),
    ...present('displayTitle', text(stream.DisplayTitle)),
    ...present('title', text(stream.Title)),
    isDefault: stream.IsDefault === true,
    isForced: stream.IsForced === true,
    isExternal: stream.IsExternal === true,
    ...present('channels', number(stream.Channels)),
    ...present('channelLayout', text(stream.ChannelLayout)),
    ...present('width', number(stream.Width)),
    ...present('height', number(stream.Height)),
    ...present('bitDepth', number(stream.BitDepth)),
    ...present('bitRate', number(stream.BitRate)),
    ...present('averageFrameRate', number(stream.AverageFrameRate) ?? number(stream.RealFrameRate)),
    ...present('profile', text(stream.Profile)),
    ...present('audioSpatialFormat', text(stream.AudioSpatialFormat)),
    ...present('videoRangeType', text(stream.VideoRangeType)),
    ...present('deliveryMethod', text(stream.DeliveryMethod)),
    ...present('deliveryUrl', text(stream.DeliveryUrl)),
  };
}

/**
 * A file's chapter marks, as `fields=Chapters` sends them. A chapter with no
 * start is not a mark, and the server's generated "Chapter 01" names are kept
 * as they come: the app decides whether a name is worth showing.
 */
export function readChapters(value: unknown): readonly { readonly startTicks: number; readonly name?: string }[] {
  const item = record(value);
  const rows = Array.isArray(item?.Chapters) ? item.Chapters : [];
  return rows.flatMap((row) => {
    const chapter = record(row);
    const startTicks = number(chapter?.StartPositionTicks);
    if (chapter === undefined || startTicks === undefined) return [];
    const name = text(chapter.Name);
    return [{ startTicks, ...(name === undefined ? {} : { name }) }];
  });
}

/**
 * What `/MediaSegments/{id}` answers. A segment needs both ends and a type
 * this app knows; anything else is left out rather than guessed at.
 */
export function readMediaSegments(value: unknown): readonly { readonly type: string; readonly startTicks: number; readonly endTicks: number }[] {
  const page = record(value);
  const rows = Array.isArray(page?.Items) ? page.Items : [];
  return rows.flatMap((row) => {
    const segment = record(row);
    const type = text(segment?.Type);
    const startTicks = number(segment?.StartTicks);
    const endTicks = number(segment?.EndTicks);
    if (type === undefined || startTicks === undefined || endTicks === undefined || endTicks <= startTicks) return [];
    return [{ type, startTicks, endTicks }];
  });
}
