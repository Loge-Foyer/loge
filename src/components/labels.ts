import type { AppErrorCode, ContentKind, Episode, ItemSort, ItemSortKey, MediaItem, PerProfile, PluginRole } from '@sc/api';

import type { HomeRow } from '@/services/home-layout';
import type { SourceError } from '@/services/media';

export const CONTENT_KIND_LABELS: Readonly<Record<ContentKind, string>> = {
  movies: 'Movies',
  shows: 'Shows',
  anime: 'Anime',
  videos: 'Videos',
  files: 'Files',
};

export const ROLE_LABELS: Readonly<Record<PluginRole, string>> = {
  media: 'Media',
  sync: 'Sync',
};

export const PER_PROFILE_LABELS: Readonly<Record<PerProfile, string>> = {
  none: 'None',
  credentials: 'Credentials',
  all: 'All',
};

export const PER_PROFILE_DESCRIPTIONS: Readonly<Record<PerProfile, string>> = {
  none: 'Every profile uses the same details.',
  credentials: 'Each profile signs in with its own account; everything else is shared.',
  all: 'Each profile has its own value for every field and setting below.',
};

/** How a connection's list row describes what each profile keeps. */
export const PER_PROFILE_SUMMARY: Readonly<Record<PerProfile, string>> = {
  none: 'Shared',
  credentials: 'Own sign-in per profile',
  all: 'Set up per profile',
};

export const SORT_LABELS: Readonly<Record<ItemSortKey, string>> = {
  releaseDate: 'Release date',
  addedAt: 'Date added',
  title: 'Title',
  rating: 'Rating',
};

/** "Newest first" for dates, "A–Z" for titles, "Highest first" for ratings. */
export function sortDirectionLabel(sort: ItemSort): string {
  if (sort.by === 'title') return sort.order === 'asc' ? 'A–Z' : 'Z–A';
  if (sort.by === 'rating') return sort.order === 'desc' ? 'Highest first' : 'Lowest first';
  return sort.order === 'desc' ? 'Newest first' : 'Oldest first';
}

/** "Movies, shows and anime". */
export function listKinds(kinds: readonly ContentKind[]): string {
  return listAll(kinds.map((kind) => CONTENT_KIND_LABELS[kind].toLowerCase()));
}

/** "Kids, Sam and Alex". */
export function listAll(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** "Jellyfin, Emby or Plex". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

/** "1 h 56 min", "42 min". */
export function formatRuntime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "23 min left", for something in progress. */
export function timeLeft(item: MediaItem): string | undefined {
  const { runtimeMs } = item;
  const position = item.watch?.positionMs;
  if (!runtimeMs || position === undefined) return undefined;
  const minutes = Math.max(1, Math.round((runtimeMs - position) / 60_000));
  return `${minutes} min left`;
}

/** "S2 · E5". */
export function episodeCode(episode: Pick<Episode, 'seasonNumber' | 'episodeNumber'>): string {
  return [
    episode.seasonNumber === undefined ? undefined : `S${episode.seasonNumber}`,
    episode.episodeNumber === undefined ? undefined : `E${episode.episodeNumber}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function formatCommunityRating(rating: number): string {
  return rating.toFixed(1);
}

const ERROR_TEXT: Readonly<Partial<Record<AppErrorCode, string>>> = {
  OFFLINE: 'is not reachable right now.',
  UNAUTHORIZED: 'did not accept the sign-in. Check it in Settings.',
  NOT_FOUND: 'no longer has this.',
  TIMEOUT: 'took too long to answer.',
  PROVIDER_UNAVAILABLE: 'is not available right now.',
  INVALID_STATE: 'cannot do this yet.',
};

/** One line for a source that could not answer: "Home server is only used on your home network." */
export function describeSourceError(error: Pick<SourceError, 'label' | 'code' | 'reason' | 'retry'>): string {
  if (error.reason === 'local-network-only') return `${error.label} is only used on your home network.`;
  // Waiting for another network, which is why it is not tried again.
  if (error.retry === 'network-change' && error.code !== 'OFFLINE') return `${error.label} can’t be reached on this network.`;
  return `${error.label} ${ERROR_TEXT[error.code] ?? 'ran into a problem.'}`;
}

/** The same, for an error that happened while trying a draft, which has no label yet. */
export function describeProbeError(error: { code: AppErrorCode; reason?: string; message: string }): string {
  if (error.reason === 'local-network-only') return 'This server is only used on your home network, and this device is on mobile data.';
  if (error.code === 'UNAUTHORIZED') return 'The server did not accept this username and password.';
  if (error.code === 'OFFLINE') return 'The server could not be reached. Check the address and the network.';
  if (error.code === 'TIMEOUT') return 'The server took too long to answer.';
  return error.message;
}

/** "Continue watching", "Movies", or "Movies · Date added" for a row a profile added. */
export function rowTitle(row: HomeRow): string {
  if (row.type === 'continue') return 'Continue watching';
  const base = CONTENT_KIND_LABELS[row.kind];
  return row.extra ? `${base} · ${SORT_LABELS[row.sort.by]}` : base;
}
