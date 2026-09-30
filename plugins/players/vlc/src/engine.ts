import {
  AppError,
  createPlayerEvents,
  playbackFailed,
  playerReleased,
  type AudioTrack,
  type MediaPlayer,
  type PlayerContext,
  type SubtitleTrack,
} from '@sc/api';

import { nativeModule, type NativePlayer, type NativeTrack } from './native';

/** The libVLC player behind each controller. This package's view draws it; nothing else touches it. */
const engines = new WeakMap<MediaPlayer, NativePlayer>();

export function engineOf(player: MediaPlayer): NativePlayer | undefined {
  return engines.get(player);
}

/**
 * libVLC on Android, through the Expo module in `android/`. Tracks keep
 * libVLC's own ids — `audio-1`, `subtitle-3` — which hold while the stream
 * is open. libVLC opens a stream when it is first played, and starts it where
 * the load asked for, so nothing waits to be applied but the tracks.
 */
export function createEngine(context: PlayerContext): MediaPlayer {
  const { Player } = nativeModule();
  const vlc = new Player();
  const events = createPlayerEvents();
  let audio: readonly NativeTrack[] = [];
  let subtitles: readonly NativeTrack[] = [];
  // Asked for at load; chosen once the stream lists them.
  let pendingAudio: string | undefined;
  let pendingSubtitle: string | null | undefined;
  let loaded = false;
  let ready = false;
  // Set once the stream has ended: libVLC plays it again only by opening it
  // anew, so the next play does that, from here.
  let restartAt: number | undefined;
  let disposed = false;
  let toldTracks = '';

  const tellTracks = () => {
    const event = {
      type: 'tracks',
      audio: audio.map((track): AudioTrack => ({ id: `audio-${track.id}`, label: track.name || `Audio ${track.id}` })),
      subtitles: subtitles.map(
        (track): SubtitleTrack => ({
          id: `subtitle-${track.id}`,
          label: track.name || `Subtitles ${track.id}`,
          // libVLC's list says nothing of a track's format; it shows every one itself.
          format: 'unknown',
          delivery: 'embedded',
        }),
      ),
    } as const;
    // Each stream added or removed tells the lists again, most often unchanged.
    const told = JSON.stringify(event);
    if (told === toldTracks) return;
    toldTracks = told;
    events.emit(event);
  };

  const chooseAudio = (id: string) => {
    const track = audio.find((each) => `audio-${each.id}` === id);
    if (!track) throw new AppError('NOT_FOUND', 'This stream has no such audio track.');
    vlc.setAudioTrack(track.id);
  };
  const chooseSubtitle = (id: string | null) => {
    if (id === null) {
      vlc.setSubtitleTrack(-1);
      return;
    }
    const track = subtitles.find((each) => `subtitle-${each.id}` === id);
    if (!track) throw new AppError('NOT_FOUND', 'This stream has no such subtitle track.');
    vlc.setSubtitleTrack(track.id);
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
    vlc.addListener('state', ({ state }) => {
      if (!loaded || events.state() === 'failed') return;
      switch (state) {
        case 'loading':
        case 'buffering':
          events.setState(ready ? 'buffering' : 'loading');
          return;
        case 'playing':
          ready = true;
          events.setState('playing');
          return;
        case 'paused':
          // Buffering done before the first frame reads as paused: it is not, yet.
          if (ready) events.setState('paused');
          return;
        case 'ended':
          restartAt = 0;
          events.setState('ended');
          return;
      }
    }),
    vlc.addListener('position', ({ positionMs, durationMs }) => {
      if (!loaded || restartAt !== undefined) return;
      events.emit({
        type: 'position',
        positionMs: Math.round(positionMs),
        ...(durationMs === undefined || !(durationMs > 0) ? {} : { durationMs: Math.round(durationMs) }),
      });
    }),
    vlc.addListener('tracks', (lists) => {
      if (!loaded) return;
      audio = lists.audio;
      subtitles = lists.subtitles;
      applyPending();
      tellTracks();
    }),
    vlc.addListener('error', ({ message }) => {
      if (loaded) events.fail(playbackFailed(message));
    }),
  ];

  const player: MediaPlayer = {
    load: async ({ source, startMs, audioTrackId, subtitleTrackId }) => {
      if (disposed) throw playerReleased();
      const headers = source.headersRef === undefined ? undefined : await context.resolveHeaders(source.headersRef);
      if (disposed) throw playerReleased();
      loaded = true;
      ready = false;
      restartAt = undefined;
      pendingAudio = audioTrackId;
      pendingSubtitle = subtitleTrackId;
      audio = [];
      subtitles = [];
      toldTracks = '';
      events.setState('loading');
      const { userAgent, referrer, others } = sendable(headers);
      if (others) {
        const failure = new AppError('INVALID_STATE', 'VLC cannot send the headers this stream needs.');
        events.fail(failure);
        throw failure;
      }
      try {
        await vlc.load(source.uri, userAgent ?? null, referrer ?? null, startMs !== undefined && startMs > 0 ? startMs : null);
      } catch (error) {
        const failure = playbackFailed(undefined, error);
        events.fail(failure);
        throw failure;
      }
    },
    play: () => {
      if (disposed) throw playerReleased();
      if (restartAt !== undefined) {
        vlc.replay(restartAt);
        restartAt = undefined;
        return;
      }
      vlc.play();
    },
    pause: () => {
      if (disposed) throw playerReleased();
      if (restartAt === undefined) vlc.pause();
    },
    seek: (positionMs) => {
      if (disposed) throw playerReleased();
      const at = Math.max(0, positionMs);
      if (restartAt === undefined) {
        vlc.seek(at);
        return;
      }
      restartAt = at;
      events.setState('paused');
      events.emit({ type: 'position', positionMs: Math.round(at) });
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
      vlc.release();
    },
  };
  engines.set(player, vlc);
  return player;
}

/** libVLC sends a user agent and a referrer, and no other header. */
function sendable(headers: Readonly<Record<string, string>> | undefined): { userAgent?: string; referrer?: string; others: boolean } {
  let userAgent: string | undefined;
  let referrer: string | undefined;
  let others = false;
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (lower === 'user-agent') userAgent = value;
    else if (lower === 'referer') referrer = value;
    else others = true;
  }
  return { ...(userAgent === undefined ? {} : { userAgent }), ...(referrer === undefined ? {} : { referrer }), others };
}
