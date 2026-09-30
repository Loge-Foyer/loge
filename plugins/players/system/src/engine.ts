import { AppError, type AudioTrack, type MediaPlayer, type PlayerContext, type PlayerLoad, type StreamProtocol, type SubtitleTrack } from '@sc/api';
import {
  createVideoPlayer,
  type AudioTrack as EngineAudioTrack,
  type ContentType,
  type SubtitleTrack as EngineSubtitleTrack,
  type VideoPlayer,
} from 'expo-video';

import { createEvents, playbackFailed, released } from './events';

/** The expo-video player behind each controller. This package's view draws it; nothing else touches it. */
const engines = new WeakMap<MediaPlayer, VideoPlayer>();

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
  const events = createEvents();
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
      if (disposed) throw released();
      const headers = source.headersRef === undefined ? undefined : await context.resolveHeaders(source.headersRef);
      if (disposed) throw released();
      loaded = true;
      ready = false;
      wantsToPlay = false;
      pending = wanted;
      audio = [];
      subtitles = [];
      toldTracks = '';
      events.setState('loading');
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
      if (disposed) throw released();
      wantsToPlay = true;
      if (events.state() === 'ended') {
        video.currentTime = 0;
        events.setState('playing');
      }
      video.play();
    },
    pause: () => {
      if (disposed) throw released();
      wantsToPlay = false;
      video.pause();
    },
    seek: (positionMs) => {
      if (disposed) throw released();
      video.currentTime = Math.max(0, positionMs) / 1000;
      if (events.state() === 'ended') events.setState('paused');
    },
    setAudioTrack: (id) => {
      if (disposed) throw released();
      chooseAudio(id);
    },
    setSubtitleTrack: (id) => {
      if (disposed) throw released();
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
