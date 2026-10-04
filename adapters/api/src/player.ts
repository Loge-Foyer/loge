import type { PlatformId } from './category';
import { AppError } from './errors';
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
  /**
   * How fast it plays, 1 being normal. Optional: an engine that cannot change
   * its rate leaves it out, and the app offers no speed for that player rather
   * than offering one that does nothing.
   */
  setRate?(rate: number): void;
  /**
   * How loud, 0 to 1. Absent where the engine has no volume of its own, and
   * the app then offers no volume slider for that player.
   */
  setVolume?(volume: number): void;
  /**
   * Allow the picture to shrink into a window that floats over everything
   * else, and to do so by itself when the app goes behind something — which
   * is how the platform models it, rather than something to be called at the
   * moment of leaving. Absent where the engine or the platform cannot: it
   * needs the picture to reach a layer the system can take over, which not
   * every engine draws into.
   */
  setPictureInPicture?(on: boolean): void;
  /** Whether the sound carries on with the app behind something else. */
  setBackgroundPlayback?(on: boolean): void;
  /** `null` turns subtitles off. */
  setSubtitleTrack(id: string | null): void;
  subscribe(listener: (event: PlayerEvent) => void): () => void;
  dispose(): Promise<void>;
}

/** What an engine gets from its host. */
/**
 * What the device asks of any engine that can honour it. Settings are the
 * app's and are the same for every player — a player is the engine, not the
 * experience — so an engine takes what it understands and ignores the rest.
 */
export interface PlayerPreferences {
  /**
   * Decode in software when the hardware decoder will not take a stream,
   * rather than refusing it. On by default, because a picture is better than
   * none; off says so loudly instead of quietly flattening the battery.
   */
  readonly softwareFallback: boolean;
  /** How far ahead to read, and where to keep it. Absent: memory, each engine's own read-ahead. */
  readonly buffering?: PlayerBuffering;
}

/**
 * How far ahead an engine reads, and where it keeps what it read — the
 * device's Buffering. `off` reads no further than playing needs; `memory`
 * is the engine's own read-ahead; `disk` keeps it on the device's storage,
 * up to `diskBytes`, where an engine can (`PlayerProfile.buffersOnDisk`) and
 * where it is worth it: never for a live stream, which would only grow, nor
 * for a file already on the device. Anything else reads ahead in memory.
 */
export interface PlayerBuffering {
  readonly mode: BufferingMode;
  readonly diskBytes: number;
}

export type BufferingMode = 'off' | 'memory' | 'disk';

/** What an engine does for one stream, the device's Buffering decided for it: disk only where it is worth it. */
export function bufferingFor(
  buffering: PlayerBuffering | undefined,
  source: { readonly uri: string; readonly live: boolean },
): { readonly mode: 'off' | 'memory' } | { readonly mode: 'disk'; readonly diskBytes: number } {
  if (buffering?.mode === 'off') return { mode: 'off' };
  if (buffering?.mode !== 'disk' || buffering.diskBytes <= 0 || source.live || /^file:/i.test(source.uri)) return { mode: 'memory' };
  return { mode: 'disk', diskBytes: buffering.diskBytes };
}

export interface PlayerContext {
  /** A stream's headers, resolved at load time and held in memory only. */
  resolveHeaders(ref: HeadersRef): Promise<Readonly<Record<string, string>> | undefined>;
  /** Absent only where nothing has been set yet; an engine should default as this document does. */
  readonly preferences?: PlayerPreferences;
}

export interface PlayerRole {
  create(context: PlayerContext): MediaPlayer;
}

/**
 * A controller's listeners and the state they last heard — how every engine
 * keeps `subscribe`'s promise. A state is told once, and a new listener hears
 * the current one at once, so a screen that subscribes after `load` still
 * knows where things are.
 */
/**
 * Rates outside this do not play: an engine either refuses or garbles the
 * sound. Every engine clamps with this rather than inventing its own bounds.
 */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(4, Math.max(0.25, rate));
}

export function createPlayerEvents() {
  const listeners = new Set<(event: PlayerEvent) => void>();
  let state: PlayerState = 'idle';
  const emit = (event: PlayerEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  const setState = (next: PlayerState) => {
    if (next === state) return;
    state = next;
    emit({ type: 'state', state: next });
  };
  return {
    emit,
    setState,
    state: () => state,
    /** A failure is a state and an error both: a screen that shows either is never left with a silent stop. */
    fail: (error: AppError) => {
      setState('failed');
      emit({ type: 'error', error });
    },
    subscribe: (listener: (event: PlayerEvent) => void) => {
      listeners.add(listener);
      listener({ type: 'state', state });
      return () => {
        listeners.delete(listener);
      };
    },
    clear: () => listeners.clear(),
  };
}

/** A player that was let go refuses everything, loudly. */
export function playerReleased(): AppError {
  return new AppError('INVALID_STATE', 'This player was released.');
}

/** An engine's failure. Most are the stream's or the network's, so trying again later can help. */
export function playbackFailed(message: string | undefined, cause?: unknown): AppError {
  return new AppError('PROVIDER_UNAVAILABLE', message && message.trim() !== '' ? message : 'The stream could not be played.', {
    retry: 'backoff',
    ...(cause === undefined ? {} : { cause }),
  });
}

/** What an engine lacks to play a source, in the order the app words it. */
export type PlayerRequirement = 'protocol' | 'container' | 'videoCodec' | 'audioCodec' | 'height';

/** Nothing when an engine with this profile plays this source. */
export function missingFor(profile: PlayerProfile, source: PlaybackSource): readonly PlayerRequirement[] {
  const missing: PlayerRequirement[] = [];
  if (!profile.protocols.includes(source.protocol)) missing.push('protocol');
  if (source.protocol === 'progressive' && source.container !== undefined && !profile.containers.includes(source.container)) missing.push('container');
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
