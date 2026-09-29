import type { PlatformId } from './category';
import type { AppError } from './errors';
import type { PluginId } from './ids';
import type { HeadersRef } from './media';
import type { AudioTrack, PlaybackSource, PlayerProfile, SubtitleTrack } from './playback';

/** What a player plugin's engine plays, on each platform it runs on. */
export interface PlayerManifest {
  readonly profiles: Readonly<Partial<Record<PlatformId, PlayerProfile>>>;
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'failed';

export type PlayerEvent =
  | { readonly type: 'state'; readonly state: PlayerState }
  | { readonly type: 'position'; readonly positionMs: number; readonly durationMs?: number }
  | { readonly type: 'tracks'; readonly audio: readonly AudioTrack[]; readonly subtitles: readonly SubtitleTrack[] }
  | { readonly type: 'error'; readonly error: AppError };

export interface PlayerLoad {
  readonly source: PlaybackSource;
  readonly startMs?: number;
  readonly audioTrackId?: string;
  readonly subtitleTrackId?: string;
}

/**
 * Drives one engine. Framework-free: the view that draws the engine's pixels
 * is `player-kit`'s, so the app never learns which engine is playing.
 */
export interface MediaPlayer {
  load(request: PlayerLoad): Promise<void>;
  play(): void;
  pause(): void;
  seek(positionMs: number): void;
  setAudioTrack(id: string): void;
  /** `null` turns subtitles off. */
  setSubtitleTrack(id: string | null): void;
  subscribe(listener: (event: PlayerEvent) => void): () => void;
  dispose(): Promise<void>;
}

/** What an engine gets from its host. */
export interface PlayerContext {
  /** A stream's headers, resolved at load time and held in memory only. */
  resolveHeaders(ref: HeadersRef): Promise<Readonly<Record<string, string>> | undefined>;
}

export interface PlayerRole {
  create(context: PlayerContext): MediaPlayer;
}

/** What an engine lacks to play a source, in the order the app words it. */
export type PlayerRequirement = 'protocol' | 'container' | 'videoCodec' | 'audioCodec' | 'height';

/** Nothing when an engine with this profile plays this source. */
export function missingFor(profile: PlayerProfile, source: PlaybackSource): readonly PlayerRequirement[] {
  const missing: PlayerRequirement[] = [];
  if (!profile.protocols.includes(source.protocol)) missing.push('protocol');
  if (source.container !== undefined && !profile.containers.includes(source.container)) missing.push('container');
  if (source.videoCodec !== undefined && !profile.videoCodecs.includes(source.videoCodec)) missing.push('videoCodec');
  // One playable audio track is enough; the rest can stay unchosen.
  if (source.audioCodecs !== undefined && source.audioCodecs.length > 0 && !source.audioCodecs.some((codec) => profile.audioCodecs.includes(codec))) {
    missing.push('audioCodec');
  }
  if (source.height !== undefined && profile.maxHeight !== undefined && source.height > profile.maxHeight) missing.push('height');
  return missing;
}

export function canPlay(profile: PlayerProfile, source: PlaybackSource): boolean {
  return missingFor(profile, source).length === 0;
}

export interface PlayerCandidate {
  readonly id: PluginId;
  readonly profile: PlayerProfile;
}

export type PlayerChoice =
  | { readonly kind: 'play'; readonly player: PluginId; readonly source: PlaybackSource }
  | { readonly kind: 'none' };

/**
 * Which enabled player plays which source. The device's preferred player wins
 * whenever it can play any of the sources; otherwise the first candidate, in
 * the order given, that can. Sources are tried in the descriptor's order, best
 * first.
 */
export function choosePlayer(
  sources: readonly PlaybackSource[],
  candidates: readonly PlayerCandidate[],
  preferred?: PluginId,
): PlayerChoice {
  const ordered = [
    ...candidates.filter((candidate) => candidate.id === preferred),
    ...candidates.filter((candidate) => candidate.id !== preferred),
  ];
  for (const candidate of ordered) {
    const source = sources.find((each) => canPlay(candidate.profile, each));
    if (source) return { kind: 'play', player: candidate.id, source };
  }
  return { kind: 'none' };
}
