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
