import type { GlobalMediaKey, HeadersRef } from './media';

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

export type HdrFormat = 'hdr10' | 'hdr10+' | 'hlg' | 'dolby-vision';

/** One way to reach a stream. A descriptor lists its best first. */
export interface PlaybackSource {
  readonly uri: string;
  /** Headers the stream needs, resolved by the engine at load time. */
  readonly headersRef?: HeadersRef;
  readonly protocol: StreamProtocol;
  /** Lower-case — `mp4`, `mkv`, `webm`, `ts` — or absent when the source cannot say. */
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
export type SubtitleDelivery = 'embedded' | 'external' | 'burned';

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

export interface PlaybackDescriptor {
  readonly key: GlobalMediaKey;
  readonly sources: readonly PlaybackSource[];
  readonly audioTracks: readonly AudioTrack[];
  readonly subtitleTracks: readonly SubtitleTrack[];
  /** Where to start: the resume position, when there is one. */
  readonly startMs?: number;
  readonly durationMs?: number;
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
  | { readonly kind: 'started'; readonly key: GlobalMediaKey; readonly positionMs: number }
  | { readonly kind: 'progress'; readonly key: GlobalMediaKey; readonly positionMs: number; readonly paused: boolean }
  | { readonly kind: 'stopped'; readonly key: GlobalMediaKey; readonly positionMs: number }
  | { readonly kind: 'played'; readonly key: GlobalMediaKey; readonly played: boolean };
