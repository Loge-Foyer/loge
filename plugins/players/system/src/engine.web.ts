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
import type Hls from 'hls.js';
import type { ErrorData } from 'hls.js';
import type Mpegts from 'mpegts.js';

/** What the engine takes from the page, so a test can hand it fakes. */
export interface WebEngineHost {
  /** A fresh `<video>`. The controller owns it; the view only places it on the page. */
  createVideo(): HTMLVideoElement;
  /** hls.js, fetched the first time a browser with no HLS of its own needs it. */
  loadHls(): Promise<typeof Hls>;
  /** mpegts.js, fetched the first time a raw MPEG-TS stream needs it. */
  loadMpegts(): Promise<typeof Mpegts>;
}

const page: WebEngineHost = {
  createVideo: () => document.createElement('video'),
  loadHls: async () => (await import('hls.js')).default,
  loadMpegts: async () => (await import('mpegts.js')).default,
};

/** The `<video>` behind each controller. This package's view places it; nothing else touches it. */
const elements = new WeakMap<MediaPlayer, HTMLVideoElement>();

export function engineOf(player: MediaPlayer): HTMLVideoElement | undefined {
  return elements.get(player);
}

/**
 * A browser's `<video>`. HLS plays natively where the browser can (Safari),
 * and through hls.js elsewhere — or whenever the stream needs a header, which
 * only hls.js's requests can carry. Raw MPEG-TS goes through mpegts.js, which
 * remuxes it for Media Source Extensions. Neither runs a worker, so the page
 * needs no `blob:` in its Content-Security-Policy for scripts.
 */
export function createEngine(context: PlayerContext, host: WebEngineHost = page): MediaPlayer {
  const video = host.createVideo();
  video.playsInline = true;
  video.preload = 'auto';
  const events = createPlayerEvents();
  let hls: Hls | undefined;
  let transport: Mpegts.Player | undefined;
  let pendingStartMs: number | undefined;
  let ready = false;
  let recovered = false;
  let disposed = false;
  let lastSecond = -1;

  const fail = (error: AppError) => {
    if (events.state() !== 'failed') events.fail(error);
    return error;
  };

  const tellPosition = () => {
    lastSecond = Math.floor(video.currentTime);
    const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : undefined;
    events.emit({ type: 'position', positionMs: Math.round(video.currentTime * 1000), ...(durationMs === undefined ? {} : { durationMs }) });
  };

  const textTracks = () => {
    const found: TextTrack[] = [];
    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index];
      if (track && (track.kind === 'subtitles' || track.kind === 'captions')) found.push(track);
    }
    return found;
  };

  const tellTracks = () => {
    const audio: AudioTrack[] = (hls?.audioTracks ?? []).map((track, index) => ({
      id: `audio-${index}`,
      label: track.name || track.lang || `Track ${index + 1}`,
      ...(track.lang ? { language: track.lang } : {}),
      ...(track.default ? { default: true } : {}),
    }));
    const subtitles: SubtitleTrack[] = hls
      ? hls.subtitleTracks.map((track, index) => ({
          id: `subtitle-${index}`,
          label: track.name || track.lang || `Subtitles ${index + 1}`,
          ...(track.lang ? { language: track.lang } : {}),
          format: 'vtt',
          delivery: 'external',
          ...(track.default ? { default: true } : {}),
          ...(track.forced ? { forced: true } : {}),
        }))
      : textTracks().map((track, index) => ({
          id: `subtitle-${index}`,
          label: track.label || track.language || `Subtitles ${index + 1}`,
          ...(track.language ? { language: track.language } : {}),
          format: 'vtt',
          delivery: 'embedded',
        }));
    events.emit({ type: 'tracks', audio, subtitles });
  };

  const detach = () => {
    hls?.destroy();
    hls = undefined;
    transport?.destroy();
    transport = undefined;
    video.removeAttribute('src');
    video.load();
  };

  const onHlsError = (HlsClass: typeof Hls, data: ErrorData) => {
    if (!data.fatal || !hls) return;
    if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && !recovered) {
      // hls.js's own advice for a fatal media error: recover once, then give up.
      recovered = true;
      hls.recoverMediaError();
      return;
    }
    const status = data.response?.code;
    if (status === 401 || status === 403) fail(new AppError('UNAUTHORIZED', 'The server refused the stream.'));
    else if (status === 404) fail(new AppError('NOT_FOUND', 'The server has no such stream.'));
    else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) fail(new AppError('INVALID_STATE', 'This browser could not decode the stream.'));
    else fail(playbackFailed(undefined, data.error));
  };

  const onTransportError = (MpegtsClass: typeof Mpegts, type: string, detail: string, info: { code?: number } | undefined) => {
    const status = info?.code;
    if (type === MpegtsClass.ErrorTypes.NETWORK_ERROR && (status === 401 || status === 403)) fail(new AppError('UNAUTHORIZED', 'The server refused the stream.'));
    else if (type === MpegtsClass.ErrorTypes.NETWORK_ERROR && status === 404) fail(new AppError('NOT_FOUND', 'The server has no such stream.'));
    else if (type === MpegtsClass.ErrorTypes.MEDIA_ERROR) fail(new AppError('INVALID_STATE', 'This browser could not decode the stream.'));
    else fail(playbackFailed(undefined, new Error(detail)));
  };

  const listeners: Readonly<Partial<Record<keyof HTMLMediaElementEventMap, () => void>>> = {
    loadedmetadata: () => {
      ready = true;
      if (pendingStartMs !== undefined && pendingStartMs > 0) video.currentTime = pendingStartMs / 1000;
      pendingStartMs = undefined;
      tellTracks();
      tellPosition();
    },
    waiting: () => {
      if (ready) events.setState('buffering');
    },
    canplay: () => {
      const state = events.state();
      if (state === 'loading' || state === 'buffering') events.setState(video.paused ? 'paused' : 'playing');
    },
    playing: () => events.setState('playing'),
    pause: () => {
      const state = events.state();
      // At the end the browser pauses first; `ended` follows.
      if (video.ended || state === 'ended' || state === 'failed' || !ready) return;
      events.setState('paused');
    },
    ended: () => events.setState('ended'),
    timeupdate: () => {
      if (Math.floor(video.currentTime) !== lastSecond) tellPosition();
    },
    seeked: tellPosition,
    durationchange: tellPosition,
    error: () => {
      const error = video.error;
      // A load that replaced this one aborted it: nothing failed.
      if (!error || error.code === error.MEDIA_ERR_ABORTED) return;
      if (hls || transport) return; // hls.js and mpegts.js report their own
      if (error.code === error.MEDIA_ERR_NETWORK) fail(playbackFailed('The stream stopped arriving.'));
      else if (error.code === error.MEDIA_ERR_DECODE) fail(new AppError('INVALID_STATE', 'This browser could not decode the stream.'));
      else fail(new AppError('PROVIDER_UNAVAILABLE', 'This browser could not open the stream.', { retry: 'never' }));
    },
  };
  for (const [type, listener] of Object.entries(listeners)) video.addEventListener(type, listener);

  const player: MediaPlayer = {
    load: async ({ source, startMs }) => {
      if (disposed) throw playerReleased();
      detach();
      ready = false;
      recovered = false;
      lastSecond = -1;
      pendingStartMs = startMs;
      events.setState('loading');
      const headers = source.headersRef === undefined ? undefined : await context.resolveHeaders(source.headersRef);
      if (disposed) throw playerReleased();
      if (source.protocol === 'hls') {
        if (!headers && video.canPlayType('application/vnd.apple.mpegurl') !== '') {
          video.src = source.uri;
          return;
        }
        let HlsClass: typeof Hls;
        try {
          HlsClass = await host.loadHls();
        } catch (error) {
          throw fail(playbackFailed('The HLS player could not be loaded.', error));
        }
        if (disposed) throw playerReleased();
        if (!HlsClass.isSupported()) throw fail(new AppError('INVALID_STATE', 'This browser cannot play HLS.'));
        const instance = new HlsClass({
          enableWorker: false,
          ...(startMs !== undefined && startMs > 0 ? { startPosition: startMs / 1000 } : {}),
          ...(headers
            ? {
                xhrSetup: (xhr: XMLHttpRequest) => {
                  for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
                },
              }
            : {}),
        });
        // hls.js starts where it was told; the metadata must not seek again.
        pendingStartMs = undefined;
        hls = instance;
        instance.on(HlsClass.Events.ERROR, (_event, data) => onHlsError(HlsClass, data));
        instance.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, tellTracks);
        instance.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, tellTracks);
        instance.loadSource(source.uri);
        instance.attachMedia(video);
        return;
      }
      if (source.protocol === 'mpegts') {
        let MpegtsClass: typeof Mpegts;
        try {
          MpegtsClass = await host.loadMpegts();
        } catch (error) {
          throw fail(playbackFailed('The MPEG-TS player could not be loaded.', error));
        }
        if (disposed) throw playerReleased();
        if (!MpegtsClass.getFeatureList().mseLivePlayback) throw fail(new AppError('INVALID_STATE', 'This browser cannot play MPEG-TS.'));
        const instance = MpegtsClass.createPlayer(
          { type: 'mpegts', isLive: source.live, url: source.uri },
          { enableWorker: false, ...(headers ? { headers: { ...headers } } : {}) },
        );
        transport = instance;
        instance.on(MpegtsClass.Events.ERROR, (type: string, detail: string, info?: { code?: number }) => onTransportError(MpegtsClass, type, detail, info));
        instance.attachMediaElement(video);
        instance.load();
        return;
      }
      if (source.protocol !== 'progressive') throw fail(new AppError('INVALID_STATE', `A browser cannot play ${source.protocol} streams.`));
      // A <video> fetches its file itself, and cannot add a header to that request.
      if (headers) throw fail(new AppError('INVALID_STATE', 'A browser cannot send the headers this stream needs.'));
      video.src = source.uri;
      video.load();
    },
    play: () => {
      if (disposed) throw playerReleased();
      if (events.state() === 'ended') video.currentTime = 0;
      video.play().catch((error: unknown) => {
        const name = nameOf(error);
        // Refused without a tap: a pause, not a failure — the play button stays.
        if (name === 'NotAllowedError') events.setState('paused');
        // A new load interrupted it.
        else if (name !== 'AbortError') fail(playbackFailed(undefined, error));
      });
    },
    pause: () => {
      if (disposed) throw playerReleased();
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
    setAudioTrack: (id) => {
      if (disposed) throw playerReleased();
      const index = indexOf(id, 'audio');
      if (!hls || index < 0 || index >= hls.audioTracks.length) throw new AppError('NOT_FOUND', 'This stream has no such audio track.');
      hls.audioTrack = index;
    },
    setSubtitleTrack: (id) => {
      if (disposed) throw playerReleased();
      const index = id === null ? -1 : indexOf(id, 'subtitle');
      if (hls) {
        if (id !== null && (index < 0 || index >= hls.subtitleTracks.length)) throw new AppError('NOT_FOUND', 'This stream has no such subtitle track.');
        hls.subtitleTrack = index;
        hls.subtitleDisplay = index >= 0;
        return;
      }
      const tracks = textTracks();
      if (id !== null && !tracks[index]) throw new AppError('NOT_FOUND', 'This stream has no such subtitle track.');
      tracks.forEach((track, each) => {
        track.mode = each === index ? 'showing' : 'disabled';
      });
    },
    subscribe: (listener) => events.subscribe(listener),
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      for (const [type, listener] of Object.entries(listeners)) video.removeEventListener(type, listener);
      events.clear();
      detach();
      video.remove();
      elements.delete(player);
    },
  };
  elements.set(player, video);
  return player;
}

function nameOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : '';
}

function indexOf(id: string, kind: 'audio' | 'subtitle'): number {
  const match = new RegExp(`^${kind}-(\\d+)$`).exec(id);
  return match ? Number(match[1]) : -1;
}
