import type {
  ConnectionId,
  ContentKind,
  GlobalMediaKey,
  ImageRef,
  Library,
  MediaDetail,
  MediaImages,
  MediaItem,
  MediaItemType,
  Person,
  PersonKind,
  Show,
  WatchStatus,
} from '@sc/api';

import type { ItemDto } from './dto';
import { itemImage, type ImageKind } from './images';

const TICKS_PER_MS = 10_000;

const ITEM_TYPES: Readonly<Record<string, MediaItemType>> = {
  Movie: 'movie',
  Series: 'show',
  Season: 'season',
  Episode: 'episode',
};

const PERSON_KINDS: Readonly<Record<string, PersonKind>> = {
  Actor: 'actor',
  GuestStar: 'actor',
  Director: 'director',
  Writer: 'writer',
  Producer: 'producer',
};

const SHOW_STATUS: Readonly<Record<string, NonNullable<Show['status']>>> = {
  Continuing: 'continuing',
  Ended: 'ended',
  Unreleased: 'upcoming',
};

/**
 * Jellyfin's item as a domain item. `expected` is the type the query asked
 * for, used when the payload leaves `Type` out.
 */
export function toMediaItem(dto: ItemDto, connectionId: ConnectionId, expected?: MediaItemType): MediaItem | undefined {
  const type = (dto.type ? ITEM_TYPES[dto.type] : undefined) ?? expected;
  if (!type) return undefined;
  const key = { connectionId, externalId: dto.id };
  const releaseDate = dateOnly(dto.premiereDate);
  const addedAt = timestamp(dto.dateCreated);
  const runtimeMs = dto.runTimeTicks === undefined ? undefined : Math.round(dto.runTimeTicks / TICKS_PER_MS);
  const year = dto.productionYear ?? yearOf(releaseDate);
  const watch = toWatch(dto, type, runtimeMs);
  const base = {
    key,
    title: dto.name ?? 'Untitled',
    ...(dto.sortName ? { sortTitle: dto.sortName } : {}),
    ...(dto.overview ? { overview: dto.overview } : {}),
    ...(year === undefined ? {} : { year }),
    ...(releaseDate ? { releaseDate } : {}),
    ...(addedAt ? { addedAt } : {}),
    ...(runtimeMs ? { runtimeMs } : {}),
    ...(dto.officialRating ? { contentRating: dto.officialRating } : {}),
    ratings: {
      // Jellyfin leaves a rating of 0 out; a 0 that does arrive means "none" too.
      ...(dto.communityRating && dto.communityRating > 0 ? { community: round1(dto.communityRating) } : {}),
      ...(dto.criticRating === undefined ? {} : { critic: Math.round(dto.criticRating) }),
    },
    genres: dto.genres,
    images: toImages(dto, type),
    ...(watch ? { watch } : {}),
  };

  switch (type) {
    case 'movie':
      return { ...base, type };
    case 'show': {
      const status = dto.status ? SHOW_STATUS[dto.status] : undefined;
      const endYear = yearOf(dateOnly(dto.endDate));
      return {
        ...base,
        type,
        ...(status ? { status } : {}),
        ...(endYear === undefined ? {} : { endYear }),
        ...(dto.childCount === undefined ? {} : { seasonCount: dto.childCount }),
      };
    }
    case 'season': {
      if (!dto.seriesId) return undefined;
      return {
        ...base,
        type,
        show: showKey(connectionId, dto.seriesId),
        ...(dto.seriesName ? { showTitle: dto.seriesName } : {}),
        ...(dto.indexNumber === undefined ? {} : { seasonNumber: dto.indexNumber }),
        ...(dto.childCount === undefined ? {} : { episodeCount: dto.childCount }),
      };
    }
    case 'episode': {
      if (!dto.seriesId) return undefined;
      return {
        ...base,
        type,
        show: showKey(connectionId, dto.seriesId),
        ...(dto.seasonId ? { season: showKey(connectionId, dto.seasonId) } : {}),
        showTitle: dto.seriesName ?? '',
        ...(dto.parentIndexNumber === undefined ? {} : { seasonNumber: dto.parentIndexNumber }),
        ...(dto.indexNumber === undefined ? {} : { episodeNumber: dto.indexNumber }),
        ...(releaseDate ? { airDate: releaseDate } : {}),
      };
    }
  }
}

export function toDetail(dto: ItemDto, connectionId: ConnectionId): MediaDetail | undefined {
  const item = toMediaItem(dto, connectionId);
  if (!item) return undefined;
  const tagline = dto.taglines[0];
  return {
    item,
    ...(tagline ? { tagline } : {}),
    people: dto.people.map(toPerson),
    studios: dto.studios,
    externalIds: Object.fromEntries(
      Object.entries(dto.providerIds).map(([catalogue, id]) => [catalogue.toLowerCase(), id]),
    ),
  };
}

/** A library view as a library, if it holds films or series. */
export function toLibrary(dto: ItemDto): Library | undefined {
  const kinds = libraryKinds(dto.collectionType);
  return kinds ? { id: dto.id, name: dto.name ?? 'Library', kinds } : undefined;
}

// A mixed library has no collection type at all.
function libraryKinds(collectionType: string | undefined): readonly ContentKind[] | undefined {
  if (collectionType === undefined) return ['movies', 'shows'];
  if (collectionType === 'movies') return ['movies'];
  if (collectionType === 'tvshows') return ['shows'];
  return undefined;
}

function toPerson(dto: ItemDto['people'][number]): Person {
  const image = dto.id && dto.primaryImageTag ? itemImage(dto.id, 'Primary', dto.primaryImageTag) : undefined;
  return {
    name: dto.name,
    ...(dto.role ? { role: dto.role } : {}),
    kind: (dto.type && PERSON_KINDS[dto.type]) || 'other',
    ...(image ? { image } : {}),
  };
}

function toImages(dto: ItemDto, type: MediaItemType): MediaImages {
  const own = (kind: ImageKind): ImageRef | undefined => {
    const tag = dto.imageTags[kind];
    return tag ? image(dto, dto.id, kind, tag) : undefined;
  };
  const backdropTag = dto.backdropImageTags[0];
  const parentBackdropTag = dto.parentBackdropImageTags[0];
  const backdrop =
    (backdropTag ? image(dto, dto.id, 'Backdrop', backdropTag, 0) : undefined) ??
    (dto.parentBackdropItemId && parentBackdropTag
      ? image(dto, dto.parentBackdropItemId, 'Backdrop', parentBackdropTag, 0)
      : undefined);
  const logo =
    own('Logo') ??
    (dto.parentLogoItemId && dto.parentLogoImageTag
      ? image(dto, dto.parentLogoItemId, 'Logo', dto.parentLogoImageTag)
      : undefined);
  const parentThumb =
    dto.parentThumbItemId && dto.parentThumbImageTag
      ? image(dto, dto.parentThumbItemId, 'Thumb', dto.parentThumbImageTag)
      : undefined;
  const seriesPoster =
    dto.seriesId && dto.seriesPrimaryImageTag ? image(dto, dto.seriesId, 'Primary', dto.seriesPrimaryImageTag) : undefined;

  // An episode's own image is a landscape still; its poster is the series'.
  const poster = type === 'episode' ? seriesPoster : (own('Primary') ?? seriesPoster);
  const thumb = type === 'episode' ? (own('Primary') ?? own('Thumb') ?? parentThumb) : (own('Thumb') ?? parentThumb);
  return {
    ...(poster ? { poster } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(thumb ? { thumb } : {}),
    ...(logo ? { logo } : {}),
  };
}

function image(dto: ItemDto, itemId: string, kind: ImageKind, tag: string, index?: number): ImageRef {
  const blurhash = dto.imageBlurHashes[kind]?.[tag];
  return itemImage(itemId, kind, tag, {
    ...(index === undefined ? {} : { index }),
    ...(blurhash ? { blurhash } : {}),
  });
}

function toWatch(dto: ItemDto, type: MediaItemType, runtimeMs: number | undefined): WatchStatus | undefined {
  const data = dto.userData;
  if (!data) return undefined;
  const positionMs = data.positionTicks && data.positionTicks > 0 ? Math.round(data.positionTicks / TICKS_PER_MS) : undefined;
  const folder = type === 'show' || type === 'season';
  const fraction =
    data.playedPercentage === undefined
      ? !folder && positionMs && runtimeMs
        ? positionMs / runtimeMs
        : undefined
      : data.playedPercentage / 100;
  const progress = fraction === undefined ? undefined : Math.min(1, Math.max(0, fraction));
  const lastPlayedAt = timestamp(data.lastPlayedDate);
  return {
    played: data.played,
    ...(positionMs && !folder ? { positionMs } : {}),
    // Nothing watched yet, or everything: neither needs a bar.
    ...(progress === undefined || progress === 0 || data.played ? {} : { progress }),
    ...(folder && data.unplayedItemCount !== undefined ? { unplayedCount: data.unplayedItemCount } : {}),
    ...(lastPlayedAt ? { lastPlayedAt } : {}),
    ...(data.isFavorite === undefined ? {} : { favorite: data.isFavorite }),
  };
}

function showKey(connectionId: ConnectionId, externalId: string): GlobalMediaKey {
  return { connectionId, externalId };
}

function dateOnly(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

/** Jellyfin writes seven fractional digits; three parse everywhere. */
function timestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/(\.\d{3})\d+/, '$1');
  return Number.isNaN(Date.parse(normalized)) ? undefined : normalized;
}

function yearOf(date: string | undefined): number | undefined {
  return date ? Number(date.slice(0, 4)) : undefined;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
