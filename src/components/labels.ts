import type {
  AppErrorCode,
  ContentKind,
  Episode,
  ItemSort,
  ItemSortKey,
  MediaItem,
  PerProfile,
  PluginCategory,
} from '@sc/api';

import type { BackupProblem } from '@/services/backup';
import type { TargetStatus } from '@/services/backup/targets';
import type { HomeRow } from '@/services/home-layout';
import type { SourceError } from '@/services/media';
import type { OwnerVerdict } from '@/services/owner-check';
import type { SyncStatus } from '@/services/sync/engine';

export const CONTENT_KIND_LABELS: Readonly<Record<ContentKind, string>> = {
  movies: 'Movies',
  shows: 'Shows',
  anime: 'Anime',
  videos: 'Videos',
  files: 'Files',
  live: 'Live TV',
};

/** Settings → Plugins' four lists. */
export const CATEGORY_LABELS: Readonly<Record<PluginCategory, string>> = {
  sources: 'Sources',
  iptv: 'IPTV',
  players: 'Players',
  sync: 'Sync',
};

/** What each list is for, in a line. */
export const CATEGORY_DESCRIPTIONS: Readonly<Record<PluginCategory, string>> = {
  sources: 'Films, series, anime, videos and files',
  iptv: 'Live TV, with a provider’s films and series',
  players: 'What plays on this device',
  sync: 'Where your account and its backups live',
};

/** What an account holds, in words: all of it, on every device of the account. */
export const ACCOUNT_HOLDS: readonly string[] = [
  'Profiles and their PINs',
  'Each profile’s settings, like its home',
  'Sources and IPTV, with their passwords',
];

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

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 days ago" — by hand: Hermes may lack Intl.RelativeTimeFormat. */
export function timeAgo(then: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function whatWentWrong(error: Pick<SourceError, 'label' | 'code' | 'reason' | 'retry' | 'needsPassword'>): string {
  if (error.needsPassword) return `${error.label} needs its password on this device. Enter it in Settings.`;
  if (error.reason === 'local-network-only') return `${error.label} is only used on your home network.`;
  // Waiting for another network, which is why it is not tried again.
  if (error.retry === 'network-change' && error.code !== 'OFFLINE') return `${error.label} can’t be reached on this network.`;
  return `${error.label} ${ERROR_TEXT[error.code] ?? 'ran into a problem.'}`;
}

/**
 * One line for a source that could not answer — "Home server is only used on
 * your home network." — and, when what was saved from it stands in, how old
 * that is.
 */
export function describeSourceError(
  error: Pick<SourceError, 'label' | 'code' | 'reason' | 'retry' | 'needsPassword' | 'savedAt'>,
  now = Date.now(),
): string {
  const line = whatWentWrong(error);
  return error.savedAt === undefined ? line : `${line} Showing what was saved ${timeAgo(error.savedAt, now)}.`;
}

/** The same, for an error that happened while trying a draft, which has no label yet. */
export function describeProbeError(error: { code: AppErrorCode; reason?: string; message: string }): string {
  if (error.reason === 'local-network-only') return 'This server is only used on your home network, and this device is on mobile data.';
  if (error.code === 'UNAUTHORIZED') return 'The server did not accept this username and password.';
  if (error.code === 'OFFLINE') return 'The server could not be reached. Check the address and the network.';
  if (error.code === 'TIMEOUT') return 'The server took too long to answer.';
  return error.message;
}

/** "Synced 5 min ago · 2 changes waiting". */
export function describeSyncStatus(status: SyncStatus, now = Date.now()): string {
  const waiting = status.pending > 0 ? `${status.pending} ${status.pending === 1 ? 'change' : 'changes'} waiting` : undefined;
  const line = syncPhaseLine(status, now);
  return waiting ? `${line} · ${waiting}` : line;
}

function syncPhaseLine({ phase, lastSyncedAt, problem }: SyncStatus, now: number): string {
  switch (phase) {
    case 'idle':
      return 'Not synced yet';
    case 'syncing':
      return 'Syncing…';
    case 'synced':
      return lastSyncedAt === undefined ? 'Synced' : `Synced ${timeAgo(lastSyncedAt, now)}`;
    case 'waiting':
      if (problem?.code === 'OFFLINE') return 'Offline — syncs when a network is back';
      if (problem?.retry === 'network-change') return 'Can’t be reached on this network';
      return 'Couldn’t sync — trying again soon';
    case 'needs-sign-in':
      return problem?.needsPassword ? 'Needs its password on this device' : 'Needs you to sign in again';
    case 'unavailable':
      return 'Can’t be used in this version of the app';
    case 'failed':
      return problem?.message ?? 'Ran into a problem';
  }
}

/** Why the owner check did not go through; nothing when someone backed out. */
export function describeOwnerVerdict(verdict: OwnerVerdict): string | undefined {
  switch (verdict) {
    case 'refused':
      return 'That didn’t confirm it’s you.';
    case 'failed':
      return 'Your account couldn’t be reached to confirm it’s you. Try again when you’re online.';
    case 'throttled':
      return 'Too many tries. Wait a little, then try again.';
    case 'unavailable':
      return 'This device can’t confirm it’s you.';
    case 'cancelled':
    case 'verified':
      return undefined;
  }
}

/** One line for a backup target: "Saved 5 min ago", or what stands in the way. */
export function describeTargetStatus(status: TargetStatus, now = Date.now()): string {
  switch (status.phase) {
    case 'saving':
      return 'Saving…';
    case 'conflict':
      return 'Changed on another device since this one saved it';
    case 'failed':
      return status.problem?.message ?? 'Couldn’t save';
    case 'saved':
      return status.savedAt === undefined ? 'Saved' : `Saved ${timeAgo(status.savedAt, now)}`;
    case 'idle':
      return status.savedAt === undefined ? 'Nothing saved here yet' : `Saved ${timeAgo(status.savedAt, now)}`;
  }
}

/** Why a backup did not open. A lost key is said plainly: there is no way round it. */
export function describeBackupProblem(problem: BackupProblem): string {
  switch (problem) {
    case 'malformed':
      return 'A backup key is nine groups of four letters and digits.';
    case 'mistyped':
      return 'Part of that key is mistyped. Check each group against where you wrote it down.';
    case 'wrong-key':
      return 'That key doesn’t open this backup. Without the key it was saved with, it can’t be opened — by anyone, this app included.';
    case 'too-large':
      return 'This file is far too large to be a Streaming Center backup.';
    case 'not-a-backup':
      return 'This isn’t a Streaming Center backup.';
    case 'newer':
      return 'This backup was saved by a newer version of Streaming Center. Update the app, then open it again.';
    case 'damaged':
      return 'This backup is damaged, and can’t be opened.';
  }
}

/** The same, for a password typed into the owner check: a refusal is a wrong password. */
export function describeProofVerdict(verdict: OwnerVerdict): string | undefined {
  return verdict === 'refused' ? 'That password isn’t right.' : describeOwnerVerdict(verdict);
}

/** "Continue watching", "Movies", or "Movies · Date added" for a row a profile added. */
export function rowTitle(row: HomeRow): string {
  if (row.type === 'continue') return 'Continue watching';
  const base = CONTENT_KIND_LABELS[row.kind];
  return row.extra ? `${base} · ${SORT_LABELS[row.sort.by]}` : base;
}
