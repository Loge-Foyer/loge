import type { GlobalMediaKey, HdrFormat, HeadersRef, SubtitleDelivery } from './media';

/**
 * What to play, as a source describes it — never how. Engines are players'
 * business (`player.ts`).
 *
 * A descriptor lives in memory only. A stream address can carry credentials —
 * Xtream puts the password in the path, a Stalker link holds a session token —
 * so it is never stored and never logged.
 */

export const STREAM_PROTOCOLS = ['progressive', 'hls', 'dash', 'mpegts'] as const;

export type StreamProtocol = (typeof STREAM_PROTOCOLS)[number];

/** One way to reach a stream. A descriptor lists its best first. */
export interface PlaybackSource {
  readonly uri: string;
  /** Headers the stream needs, resolved by the engine at load time. */
  readonly headersRef?: HeadersRef;
  readonly protocol: StreamProtocol;
  /**
   * A progressive file's container, lower-case — `mp4`, `mkv`, `webm`, `ts` —
   * or absent when the source cannot say. A stream's protocol already says
   * what it is, and no engine is judged by the container a stream names.
   */
  readonly container?: string;
  /** Lower-case — `h264`, `hevc`, `av1`, `vp9`. */
  readonly videoCodec?: string;
  /** Lower-case — `aac`, `ac3`, `eac3`, `dts`, `truehd`, `opus`. One is enough to play. */
  readonly audioCodecs?: readonly string[];
  readonly hdr?: HdrFormat;
  readonly height?: number;
  /** The server converts it for the player that asked; direct play is `false`. */
  readonly transcoded: boolean;
  readonly live: boolean;
}

export interface AudioTrack {
  readonly id: string;
  readonly label: string;
  /** BCP 47, where the source knows it. */
  readonly language?: string;
  readonly codec?: string;
  readonly channels?: number;
  readonly default?: boolean;
}

/** Inside the stream, a file of its own, or painted into the picture by the server. */

export interface SubtitleTrack {
  readonly id: string;
  readonly label: string;
  readonly language?: string;
  /** Lower-case — `srt`, `vtt`, `ass`, `pgs`. */
  readonly format: string;
  readonly delivery: SubtitleDelivery;
  /** For an external track. */
  readonly uri?: string;
  readonly forced?: boolean;
  readonly default?: boolean;
}

/** Where a file is divided, for the scrubber to show. A title where the file names one. */
export interface Chapter {
  readonly startMs: number;
  readonly title?: string;
}

/**
 * What a stretch of a file is. `intro` and `recap` are offered as a skip
 * forward; `outro` is where the next episode is offered instead.
 */
export const MEDIA_SEGMENT_KINDS = ['intro', 'outro', 'recap', 'preview', 'commercial'] as const;

export type MediaSegmentKind = (typeof MEDIA_SEGMENT_KINDS)[number];

/**
 * A stretch of a file worth offering to skip. Sources that have none — most —
 * send none, and the player simply offers nothing.
 */
export interface MediaSegment {
  readonly kind: MediaSegmentKind;
  readonly startMs: number;
  readonly endMs: number;
}

export interface PlaybackDescriptor {
  readonly key: GlobalMediaKey;
  readonly sources: readonly PlaybackSource[];
  readonly audioTracks: readonly AudioTrack[];
  readonly subtitleTracks: readonly SubtitleTrack[];
  /** Where to start: the resume position, when there is one. */
  readonly startMs?: number;
  readonly durationMs?: number;
  /** In order, from the start of the file. Empty or absent where the source has none. */
  readonly chapters?: readonly Chapter[];
  /** In order, and may overlap: a recap can sit inside an intro. */
  readonly segments?: readonly MediaSegment[];
}

/** The segment covering a position, preferring the one that ends soonest where they overlap. */
export function segmentAt(segments: readonly MediaSegment[] | undefined, positionMs: number): MediaSegment | undefined {
  let found: MediaSegment | undefined;
  for (const segment of segments ?? []) {
    if (positionMs < segment.startMs || positionMs >= segment.endMs) continue;
    if (!found || segment.endMs < found.endMs) found = segment;
  }
  return found;
}

/**
 * What an engine can play on the platform it runs on. A source that
 * transcodes — Jellyfin — is handed this, and answers with what fits.
 */
export interface PlayerProfile {
  readonly protocols: readonly StreamProtocol[];
  readonly containers: readonly string[];
  readonly videoCodecs: readonly string[];
  readonly audioCodecs: readonly string[];
  readonly subtitleFormats: readonly string[];
  readonly hdr?: readonly HdrFormat[];
  readonly maxHeight?: number;
  /**
   * Whether this engine can hand its picture to the system as a floating
   * window *by itself* on this platform. It needs a layer the system can take
   * over, which not every engine draws into.
   *
   * Android is the exception and is not described here: there the activity
   * shrinks, so every engine gets it whatever it draws with, and the app
   * arranges it for all of them at once.
   */
  readonly pictureInPicture?: boolean;
  /**
   * Whether this engine can keep what it reads ahead on the device's storage
   * rather than in memory, where the device's Buffering asks it to. One that
   * cannot reads ahead in memory instead.
   */
  readonly buffersOnDisk?: boolean;
}

/** `getPlaybackDescriptor`'s question: this item, for this engine. */
export interface PlaybackRequest {
  readonly key: GlobalMediaKey;
  readonly profile: PlayerProfile;
  readonly startMs?: number;
  readonly audioTrackId?: string;
  readonly subtitleTrackId?: string;
}

/**
 * What playing reports back to a source that keeps watch status
 * (`watchStateWrite`). It goes through the outbox, never straight from the
 * player, so it survives airplane mode.
 */
export type PlaybackReport =
  | { readonly kind: 'started'; readonly key: GlobalMediaKey; readonly positionMs: number; readonly durationMs?: number }
  | { readonly kind: 'progress'; readonly key: GlobalMediaKey; readonly positionMs: number; readonly paused: boolean; readonly durationMs?: number }
  | { readonly kind: 'stopped'; readonly key: GlobalMediaKey; readonly positionMs: number; readonly durationMs?: number }
  | { readonly kind: 'played'; readonly key: GlobalMediaKey; readonly played: boolean };

/** Where playback got to — what `reportPlayback` takes. Watched or not goes through `setPlayed`. */
export type ProgressReport = Exclude<PlaybackReport, { readonly kind: 'played' }>;
