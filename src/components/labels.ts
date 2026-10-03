import type {
  AppErrorCode,
  ContentKind,
  Episode,
  HdrFormat,
  ItemSort,
  ItemSortKey,
  MediaItem,
  PerProfile,
  PlaybackSource,
  PlayerRequirement,
  PluginCategory,
  SpatialAudio,
} from '@loge/api';

import type { BackupProblem } from '@/services/backup';
import type { TargetStatus } from '@/services/backup/targets';
import type { HomeRow } from '@/services/home-layout';
import type { SourceError } from '@/services/media';
import type { OwnerVerdict } from '@/services/owner-check';
import type { SyncStatus } from '@/services/sync/engine';
import type { ContentTab } from '@/services/tab-content';

/** The tabs that show content, by the names on the tab bar. */
export const TAB_LABELS: Readonly<Record<ContentTab, string>> = {
  media: 'Media',
  videos: 'Videos',
  tv: 'TV',
};

export const CONTENT_KIND_LABELS: Readonly<Record<ContentKind, string>> = {
  movies: 'Movies',
  shows: 'Shows',
  anime: 'Anime',
  videos: 'Videos',
  files: 'Files',
  live: 'Live TV',
};

/** Settings → Adapters' five lists. */
export const CATEGORY_LABELS: Readonly<Record<PluginCategory, string>> = {
  sources: 'Sources',
  iptv: 'IPTV',
  players: 'Players',
  sync: 'Sync',
  metadata: 'Metadata',
};

/** What each list is for, in a line. */
export const CATEGORY_DESCRIPTIONS: Readonly<Record<PluginCategory, string>> = {
  sources: 'Films, series, anime, videos and files',
  iptv: 'Live TV, with a provider’s films and series',
  players: 'What plays on this device',
  sync: 'Where your account and its backups live',
  metadata: 'What a film or series is, for watch status',
};

/** What an account holds, in words: all of it, on every device of the account. */
export const ACCOUNT_HOLDS: readonly string[] = [
  'Profiles and their PINs',
  'Each profile’s settings, like its home',
  'Sources, IPTV and metadata, with their passwords and keys',
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

/** "4:07", "1:05:09": a position or a length, as a player shows it. */
export function clockTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** "20:15": a moment of the day, in the device's own time. */
export function clockOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

const FORMAT_NAMES: Readonly<Record<string, string>> = {
  mpegts: 'MPEG-TS',
  hls: 'HLS',
  dash: 'DASH',
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  mpeg2video: 'MPEG-2',
  vc1: 'VC-1',
  aac: 'AAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  dtshd: 'DTS-HD',
  truehd: 'TrueHD',
  flac: 'FLAC',
  opus: 'Opus',
  mp3: 'MP3',
  subrip: 'SubRip',
  srt: 'SubRip',
  ass: 'ASS',
  ssa: 'SSA',
  pgssub: 'PGS',
  pgs: 'PGS',
  vtt: 'WebVTT',
  webvtt: 'WebVTT',
  dvdsub: 'VobSub',
  mkv: 'Matroska',
  matroska: 'Matroska',
  mp4: 'MP4',
  mov: 'QuickTime',
  webm: 'WebM',
  avi: 'AVI',
  ts: 'MPEG-TS',
};
export const formatName = (name: string) => FORMAT_NAMES[name] ?? name.toUpperCase();

const HDR_NAMES: Readonly<Record<HdrFormat, string>> = {
  hdr10: 'HDR10',
  'hdr10+': 'HDR10+',
  hlg: 'HLG',
  'dolby-vision': 'Dolby Vision',
};
export const hdrName = (hdr: HdrFormat) => HDR_NAMES[hdr];

const SPATIAL_NAMES: Readonly<Record<SpatialAudio, string>> = {
  'dolby-atmos': 'Dolby Atmos',
  'dts-x': 'DTS:X',
  // The source said there is one and did not say which.
  other: 'Spatial audio',
};
export const spatialName = (spatial: SpatialAudio) => SPATIAL_NAMES[spatial];

/**
 * A resolution as people name it rather than as pixels. The thresholds are
 * generous downwards because a 1920×804 scope film is still "1080p".
 */
export function resolutionName(height: number | undefined, width?: number): string | undefined {
  const lines = height ?? 0;
  const across = width ?? 0;
  if (lines >= 2000 || across >= 3600) return '4K';
  if (lines >= 1400 || across >= 2400) return '1440p';
  if (lines >= 900 || across >= 1800) return '1080p';
  if (lines >= 700 || across >= 1200) return '720p';
  if (lines >= 540 || across >= 900) return '576p';
  if (lines > 0) return `${lines}p`;
  return undefined;
}

/**
 * Bytes as a person reads them, in the units a file manager uses — powers of
 * 1024, which is what "68 GB" means when a server reports 68,719,476,736.
 */
export function fileSize(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Whole bytes and kilobytes; one decimal above that, until it stops earning one.
  const rounded = unit <= 1 ? Math.round(value) : value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Bits per second as Mbps, which is how every player and server states it. */
export function bitrateName(bitsPerSecond: number | undefined): string | undefined {
  if (bitsPerSecond === undefined || bitsPerSecond <= 0) return undefined;
  const mbps = bitsPerSecond / 1_000_000;
  return `${mbps >= 10 ? Math.round(mbps) : Math.round(mbps * 10) / 10} Mbps`;
}

/**
 * A channel count as a layout, when the source did not name one. 8 channels is
 * 7.1, 6 is 5.1 — the two that matter; anything else says the number.
 */
export function channelName(channels: number | undefined, layout: string | undefined): string | undefined {
  if (layout) return layout;
  if (channels === undefined || channels <= 0) return undefined;
  if (channels === 8) return '7.1';
  if (channels === 6) return '5.1';
  if (channels === 2) return 'Stereo';
  if (channels === 1) return 'Mono';
  return `${channels} channels`;
}

/** A BCP 47 or ISO code as the language's own name, where this device knows one. */
export function languageName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  // Hermes has Intl.DisplayNames from RN 0.73; where it does not, the code is
  // still better than nothing, and never worse than a wrong guess.
  try {
    const names = new Intl.DisplayNames(undefined, { type: 'language' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "This needs a player that plays MPEG-TS." — what no player on this device can do, in the order the engine lacks it. */
export function describeMissing(needs: readonly PlayerRequirement[], source: PlaybackSource | undefined): string {
  const [need] = needs;
  if (!source || !need) return 'No player on this device plays this.';
  const what =
    need === 'protocol'
      ? source.protocol === 'progressive'
        ? 'files like this one'
        : formatName(source.protocol)
      : need === 'container'
        ? `${formatName(source.container ?? 'this kind of')} files`
        : need === 'videoCodec'
          ? `${formatName(source.videoCodec ?? 'this')} video`
          : need === 'audioCodec'
            ? `${formatName(source.audioCodecs?.[0] ?? 'this')} audio`
            : `${source.height ?? 'this'}p video`;
  return `This needs a player that plays ${what}.`;
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

/**
 * A count as a video site writes it: 980, 12K, 1.2M. Spelled by hand — Hermes
 * may lack `Intl.NumberFormat`'s compact notation.
 */
export function compactCount(count: number): string {
  const units: readonly (readonly [number, string])[] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, unit] of units) {
    if (count >= size) {
      const value = count / size;
      // One decimal below ten — 1.2M — and none above: 12M, 120K.
      return `${value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value)}${unit}`;
    }
  }
  return String(Math.round(count));
}

/** "1.2M followers", "1 follower". */
export function followersLabel(count: number): string {
  return count === 1 ? '1 follower' : `${compactCount(count)} followers`;
}

/** "24 videos", "1 video". */
export function videoCountLabel(count: number): string {
  return count === 1 ? '1 video' : `${compactCount(count)} videos`;
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
      return 'This file is far too large to be a Loge backup.';
    case 'not-a-backup':
      return 'This isn’t a Loge backup.';
    case 'newer':
      return 'This backup was saved by a newer version of Loge. Update the app, then open it again.';
    case 'damaged':
      return 'This backup is damaged, and can’t be opened.';
  }
}

/** The same, for a password typed into the owner check: a refusal is a wrong password. */
export function describeProofVerdict(verdict: OwnerVerdict): string | undefined {
  return verdict === 'refused' ? 'That password isn’t right.' : describeOwnerVerdict(verdict);
}

/** "Continue watching", "Downloaded", "Movies", or "Movies · Date added" for a row a profile added. */
export function rowTitle(row: HomeRow): string {
  if (row.type === 'continue') return 'Continue watching';
  if (row.type === 'downloads') return 'Downloaded';
  const base = CONTENT_KIND_LABELS[row.kind];
  return row.extra ? `${base} · ${SORT_LABELS[row.sort.by]}` : base;
}
