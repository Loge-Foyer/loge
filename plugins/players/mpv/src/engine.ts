import {
  AppError,
  clampRate,
  createPlayerEvents,
  playbackFailed,
  playerReleased,
  type AudioTrack,
  type MediaPlayer,
  type PlayerContext,
  type SubtitleTrack,
} from '@sc/api';

import { nativeModule, type NativePlayer, type NativeTrack } from './native';

/** The mpv core behind each controller. This package's view draws it; nothing else touches it. */
const engines = new WeakMap<MediaPlayer, NativePlayer>();

export function engineOf(player: MediaPlayer): NativePlayer | undefined {
  return engines.get(player);
}

/** FFmpeg's names for the subtitle formats the domain has a word for. */
const SUBTITLE_FORMATS: Readonly<Record<string, string>> = {
  subrip: 'srt',
  srt: 'srt',
  ass: 'ass',
  ssa: 'ass',
  webvtt: 'vtt',
  vtt: 'vtt',
  hdmv_pgs_subtitle: 'pgs',
  pgs: 'pgs',
  dvd_subtitle: 'dvdsub',
  dvb_subtitle: 'dvbsub',
  mov_text: 'mov_text',
};

/**
 * mpv on Android, through the Expo module in `android/`. Tracks keep mpv's own
 * ids — `audio-2`, `subtitle-3` — which hold while the file is open, and carry
 * the language and codec mpv read from it. mpv starts a file where the load
 * asked, and holds the last frame at the end, so playing again is a seek.
 */
export function createEngine(context: PlayerContext): MediaPlayer {
  const { Player } = nativeModule();
  const mpv = new Player();
  const events = createPlayerEvents();
  let audio: readonly NativeTrack[] = [];
  let subtitles: readonly NativeTrack[] = [];
  // Asked for at load; chosen once the file lists them.
  let pendingAudio: string | undefined;
  let pendingSubtitle: string | null | undefined;
  let loaded = false;
  // Set once the file has ended: the next play seeks back to here.
  let restartAt: number | undefined;
  let disposed = false;
  let toldTracks = '';

  const tellTracks = () => {
    const event = {
      type: 'tracks',
      audio: audio.map(
        (track): AudioTrack => ({
          id: `audio-${track.id}`,
          label: label(track, `Audio ${track.id}`),
          ...(track.language === undefined ? {} : { language: track.language }),
          ...(track.codec === undefined ? {} : { codec: track.codec }),
        }),
      ),
      subtitles: subtitles.map(
        (track): SubtitleTrack => ({
          id: `subtitle-${track.id}`,
          label: label(track, `Subtitles ${track.id}`),
          format: track.codec === undefined ? 'unknown' : (SUBTITLE_FORMATS[track.codec] ?? track.codec),
          // mpv opens nothing beside the stream, so every track it lists is in it.
          delivery: 'embedded',
          ...(track.language === undefined ? {} : { language: track.language }),
        }),
      ),
    } as const;
    // Each track added or removed tells the lists again, most often unchanged.
    const told = JSON.stringify(event);
    if (told === toldTracks) return;
    toldTracks = told;
    events.emit(event);
  };

  const chooseAudio = (id: string) => {
    const track = audio.find((each) => `audio-${each.id}` === id);
    if (!track) throw new AppError('NOT_FOUND', 'This stream has no such audio track.');
    mpv.setAudioTrack(track.id);
  };
  const chooseSubtitle = (id: string | null) => {
    if (id === null) {
      mpv.setSubtitleTrack(-1);
      return;
    }
    const track = subtitles.find((each) => `subtitle-${each.id}` === id);
    if (!track) throw new AppError('NOT_FOUND', 'This stream has no such subtitle track.');
    mpv.setSubtitleTrack(track.id);
  };

  const applyPending = () => {
    if (pendingAudio !== undefined && audio.some((track) => `audio-${track.id}` === pendingAudio)) {
      chooseAudio(pendingAudio);
      pendingAudio = undefined;
    }
    if (pendingSubtitle === null || (pendingSubtitle !== undefined && subtitles.some((track) => `subtitle-${track.id}` === pendingSubtitle))) {
      chooseSubtitle(pendingSubtitle);
      pendingSubtitle = undefined;
    }
  };

  const subscriptions = [
    mpv.addListener('state', ({ state }) => {
      if (!loaded || events.state() === 'failed') return;
      switch (state) {
        case 'loading':
          events.setState('loading');
          return;
        case 'buffering':
          events.setState('buffering');
          return;
        case 'playing':
          events.setState('playing');
          return;
        case 'paused':
          events.setState('paused');
          return;
        case 'ended':
          restartAt = 0;
          events.setState('ended');
          return;
      }
    }),
    mpv.addListener('position', ({ positionMs, durationMs }) => {
      if (!loaded || restartAt !== undefined) return;
      events.emit({
        type: 'position',
        positionMs: Math.round(positionMs),
        ...(durationMs === undefined || !(durationMs > 0) ? {} : { durationMs: Math.round(durationMs) }),
      });
    }),
    mpv.addListener('tracks', (lists) => {
      if (!loaded) return;
      audio = lists.audio;
      subtitles = lists.subtitles;
      applyPending();
      tellTracks();
    }),
    mpv.addListener('error', ({ message }) => {
      if (loaded) events.fail(playbackFailed(message));
    }),
  ];

  const player: MediaPlayer = {
    load: async ({ source, startMs, audioTrackId, subtitleTrackId }) => {
      if (disposed) throw playerReleased();
      const headers = source.headersRef === undefined ? undefined : await context.resolveHeaders(source.headersRef);
      if (disposed) throw playerReleased();
      loaded = true;
      restartAt = undefined;
      pendingAudio = audioTrackId;
      pendingSubtitle = subtitleTrackId;
      audio = [];
      subtitles = [];
      toldTracks = '';
      events.setState('loading');
      try {
        await mpv.load(source.uri, headers ?? null, startMs !== undefined && startMs > 0 ? startMs : null);
      } catch (error) {
        const failure = playbackFailed(undefined, error);
        events.fail(failure);
        throw failure;
      }
    },
    play: () => {
      if (disposed) throw playerReleased();
      if (restartAt !== undefined) {
        mpv.replay(restartAt);
        restartAt = undefined;
        return;
      }
      mpv.play();
    },
    pause: () => {
      if (disposed) throw playerReleased();
      if (restartAt === undefined) mpv.pause();
    },
    seek: (positionMs) => {
      if (disposed) throw playerReleased();
      const at = Math.max(0, positionMs);
      if (restartAt === undefined) {
        mpv.seek(at);
        return;
      }
      // Ended: where to play from next, and the scrubber follows at once.
      restartAt = at;
      events.setState('paused');
      events.emit({ type: 'position', positionMs: Math.round(at) });
    },
    setRate: (rate) => {
      if (disposed) throw playerReleased();
      mpv.setRate(clampRate(rate));
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
      mpv.release();
    },
  };
  engines.set(player, mpv);
  return player;
}

/** What the file calls a track, else its language, else its number. */
function label(track: NativeTrack, fallback: string): string {
  if (track.title !== undefined && track.title !== '') return track.title;
  if (track.language !== undefined && track.language !== '') return track.language;
  return fallback;
}
