import {
  AppError,
  bufferingFor,
  clampRate,
  createPlayerEvents,
  playbackFailed,
  playerReleased,
  type AudioTrack,
  type MediaPlayer,
  type PlayerContext,
  type PlayerLoad,
  type StreamProtocol,
  type SubtitleTrack,
} from '@loge/api';
import {
  createVideoPlayer,
  type AudioTrack as EngineAudioTrack,
  type BufferOptions,
  type ContentType,
  type SubtitleTrack as EngineSubtitleTrack,
  type VideoPlayer,
} from 'expo-video';

/**
 * The device's Buffering at Off: a few seconds ahead, played as soon as they
 * are in. Memory is the engine's own; so is Disk — expo-video's cache keeps a
 * file for replaying, keyed by its whole address, which a stream's per-play
 * token never repeats.
 */
const NO_READ_AHEAD: BufferOptions = { preferredForwardBufferDuration: 3, waitsToMinimizeStalling: false, minBufferForPlayback: 1 };

/** The expo-video player behind each controller. This package's view draws it; nothing else touches it. */
const engines = new WeakMap<MediaPlayer, VideoPlayer>();

/**
 * Picture in picture belongs to the view, not the player: the system takes
 * over a layer, and only the view has one. The view lends the controller its
 * handle while it is mounted, and takes it back when it goes.
 */
const wanted = new WeakMap<MediaPlayer, boolean>();
const watchers = new WeakMap<MediaPlayer, Set<() => void>>();

/** Whether this controller's view should let the system take its picture. */
export function pictureInPictureOf(player: MediaPlayer): boolean {
  return wanted.get(player) ?? false;
}

/**
 * Told whenever the app arms or disarms it. The system reads the view's flag
 * as the app is left, so the view has to follow every change — armed while a
 * film plays, never while it is paused or over.
 */
export function watchPictureInPicture(player: MediaPlayer, listener: () => void): () => void {
  const listeners = watchers.get(player) ?? new Set<() => void>();
  watchers.set(player, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function engineOf(player: MediaPlayer): VideoPlayer | undefined {
  return engines.get(player);
}



const CONTENT_TYPES: Readonly<Record<StreamProtocol, ContentType>> = {
  progressive: 'progressive',
  hls: 'hls',
  dash: 'dash',
  // Media3 reads raw MPEG-TS as a progressive stream. AVPlayer cannot, and its profile says so.
  mpegts: 'progressive',
};

/**
 * AVPlayer on iOS, Media3 on Android. expo-video names tracks by their
 * position (iOS gives them no id), so this does too: `audio-0`, `subtitle-1`.
 */
export function createEngine(context: PlayerContext): MediaPlayer {
  const video = createVideoPlayer(null);
  // Once a second: enough for a scrubber and for progress reports.
  video.timeUpdateEventInterval = 1;
  const events = createPlayerEvents();
  let audio: readonly EngineAudioTrack[] = [];
  let subtitles: readonly EngineSubtitleTrack[] = [];
  // Applied once the stream is ready: AVPlayer drops a seek made before then.
  let pending: Omit<PlayerLoad, 'source'> | undefined;
  // The empty player sends events too — an end, time updates — before anything is loaded.
  let loaded = false;
  let ready = false;
  // What was asked for, which the engine's own flag lags behind: Media3 is not
  // "playing" while it buffers, and a stream turns ready before it starts.
  let wantsToPlay = false;
  let disposed = false;
  let toldTracks = '';

  const tellTracks = () => {
    const event = {
      type: 'tracks',
      audio: audio.map((track, index): AudioTrack => ({ id: `audio-${index}`, ...describe(track), ...(track.isDefault ? { default: true } : {}) })),
      subtitles: subtitles.map(
        (track, index): SubtitleTrack => ({
          id: `subtitle-${index}`,
          ...describe(track),
          // The engine shows it itself, whether the stream carries it or the source added it.
          format: 'vtt',
          delivery: 'embedded',
          ...(track.isDefault ? { default: true } : {}),
        }),
      ),
    } as const;
    // Loading reports the same lists more than once.
    const told = JSON.stringify(event);
    if (told === toldTracks) return;
    toldTracks = told;
    events.emit(event);
  };

  const applyPending = () => {
    const wanted = pending;
    pending = undefined;
    if (!wanted) return;
    if (wanted.startMs !== undefined && wanted.startMs > 0) video.currentTime = wanted.startMs / 1000;
    if (wanted.audioTrackId !== undefined) chooseAudio(wanted.audioTrackId);
    if (wanted.subtitleTrackId !== undefined) chooseSubtitle(wanted.subtitleTrackId);
  };

  const chooseAudio = (id: string) => {
    const track = audio[indexOf(id, 'audio')];
    if (!track) throw new AppError('NOT_FOUND', 'This stream has no such audio track.');
    video.audioTrack = track;
  };
  const chooseSubtitle = (id: string | null) => {
    if (id === null) {
      video.subtitleTrack = null;
      return;
    }
    const track = subtitles[indexOf(id, 'subtitle')];
    if (!track) throw new AppError('NOT_FOUND', 'This stream has no such subtitle track.');
    video.subtitleTrack = track;
  };

  const subscriptions = [
    video.addListener('statusChange', ({ status, error }) => {
      if (!loaded) return;
      if (status === 'error') events.fail(playbackFailed(error?.message));
      else if (status === 'loading') events.setState(ready ? 'buffering' : 'loading');
      else if (status === 'readyToPlay') {
        if (!ready) {
          ready = true;
          applyPending();
        }
        events.setState(wantsToPlay || video.playing ? 'playing' : 'paused');
      }
    }),
    video.addListener('playingChange', ({ isPlaying }) => {
      const state = events.state();
      if (!loaded || !ready || state === 'failed' || state === 'ended') return;
      // Started from outside the app — the lock screen, a headset.
      if (isPlaying) wantsToPlay = true;
      if (video.status === 'loading') events.setState('buffering');
      else events.setState(isPlaying ? 'playing' : 'paused');
    }),
    video.addListener('timeUpdate', ({ currentTime }) => {
      if (!loaded) return;
      const durationMs = video.isLive || !(video.duration > 0) ? undefined : Math.round(video.duration * 1000);
      events.emit({ type: 'position', positionMs: Math.round(currentTime * 1000), ...(durationMs === undefined ? {} : { durationMs }) });
    }),
    video.addListener('playToEnd', () => {
      if (loaded) events.setState('ended');
    }),
    video.addListener('sourceLoad', ({ availableAudioTracks, availableSubtitleTracks }) => {
      if (!loaded) return;
      audio = availableAudioTracks;
      subtitles = availableSubtitleTracks;
      tellTracks();
    }),
    video.addListener('availableAudioTracksChange', ({ availableAudioTracks }) => {
      if (!loaded) return;
      audio = availableAudioTracks;
      tellTracks();
    }),
    video.addListener('availableSubtitleTracksChange', ({ availableSubtitleTracks }) => {
      if (!loaded) return;
      subtitles = availableSubtitleTracks;
      tellTracks();
    }),
  ];

  const player: MediaPlayer = {
    load: async ({ source, ...wanted }) => {
      if (disposed) throw playerReleased();
      const headers = source.headersRef === undefined ? undefined : await context.resolveHeaders(source.headersRef);
      if (disposed) throw playerReleased();
      loaded = true;
      ready = false;
      wantsToPlay = false;
      pending = wanted;
      audio = [];
      subtitles = [];
      toldTracks = '';
      events.setState('loading');
      if (bufferingFor(context.preferences?.buffering, source).mode === 'off') video.bufferOptions = NO_READ_AHEAD;
      try {
        // Off the UI thread: `replace` loads the asset synchronously on iOS.
        await video.replaceAsync({ uri: source.uri, contentType: CONTENT_TYPES[source.protocol], ...(headers ? { headers: { ...headers } } : {}) });
      } catch (error) {
        const failure = playbackFailed(undefined, error);
        events.fail(failure);
        throw failure;
      }
    },
    play: () => {
      if (disposed) throw playerReleased();
      wantsToPlay = true;
      if (events.state() === 'ended') {
        video.currentTime = 0;
        events.setState('playing');
      }
      video.play();
    },
    pause: () => {
      if (disposed) throw playerReleased();
      wantsToPlay = false;
      video.pause();
    },
    seek: (positionMs) => {
      if (disposed) throw playerReleased();
      video.currentTime = Math.max(0, positionMs) / 1000;
      if (events.state() === 'ended') events.setState('paused');
    },
    setRate: (rate) => {
      if (disposed) throw playerReleased();
      video.playbackRate = clampRate(rate);
    },
    setVolume: (volume) => {
      if (disposed) throw playerReleased();
      video.volume = Math.min(1, Math.max(0, volume));
    },
    setBackgroundPlayback: (on) => {
      if (disposed) throw playerReleased();
      video.staysActiveInBackground = on;
    },
    setPictureInPicture: (on) => {
      if (disposed) throw playerReleased();
      if (pictureInPictureOf(player) === on) return;
      wanted.set(player, on);
      for (const listener of [...(watchers.get(player) ?? [])]) listener();
    },
    setAudioTrack: (id) => {
      if (disposed) throw playerReleased();
      chooseAudio(id);
    },
    setSubtitleTrack: (id) => {
      if (disposed) throw playerReleased();
      chooseSubtitle(id);
    },
    subscribe: (listener) => events.subscribe(listener),
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      for (const subscription of subscriptions) subscription.remove();
      events.clear();
      engines.delete(player);
      video.release();
    },
  };
  engines.set(player, video);
  return player;
}

function describe(track: EngineAudioTrack | EngineSubtitleTrack): { label: string; language?: string } {
  const label = track.label || track.name || track.language || 'Unknown';
  return { label, ...(track.language ? { language: track.language } : {}) };
}

function indexOf(id: string, kind: 'audio' | 'subtitle'): number {
  const match = new RegExp(`^${kind}-(\\d+)$`).exec(id);
  return match ? Number(match[1]) : -1;
}
