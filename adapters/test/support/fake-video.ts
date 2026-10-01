// A browser's <video>, hls.js and mpegts.js, as the built-in player's web
// engine sees them: an EventTarget with the members it touches, and players
// whose events the test sends.
import type Hls from 'hls.js';
import type Mpegts from 'mpegts.js';

export class FakeVideoElement extends EventTarget {
  playsInline = false;
  preload = '';
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  disablePictureInPicture = false;
  pictureInPictureRequests = 0;

  async requestPictureInPicture() {
    this.pictureInPictureRequests += 1;
  }
  ended = false;
  error: { code: number; MEDIA_ERR_ABORTED: 1; MEDIA_ERR_NETWORK: 2; MEDIA_ERR_DECODE: 3; MEDIA_ERR_SRC_NOT_SUPPORTED: 4 } | null = null;
  readonly textTracks: { kind: string; label: string; language: string; mode: string }[] & { length: number } = [];
  readonly style: Record<string, string> = {};
  nativeHls = false;
  loads = 0;
  removed = false;
  playResult: () => Promise<void> = async () => {};

  canPlayType(type: string): string {
    return this.nativeHls && type === 'application/vnd.apple.mpegurl' ? 'maybe' : '';
  }

  play(): Promise<void> {
    this.paused = false;
    return this.playResult();
  }

  pause() {
    this.paused = true;
  }

  load() {
    this.loads += 1;
  }

  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }

  remove() {
    this.removed = true;
  }

  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }

  failWith(code: 1 | 2 | 3 | 4) {
    this.error = { code, MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 };
    this.fire('error');
  }
}

type Handler = (event: string, data: never) => void;

export function fakeHls(options: { supported?: boolean } = {}) {
  const instances: FakeHls[] = [];
  class FakeHls {
    static isSupported = () => options.supported ?? true;
    static Events = { ERROR: 'hlsError', AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated', SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError', OTHER_ERROR: 'otherError' };
    readonly handlers = new Map<string, Handler[]>();
    source: string | undefined;
    media: unknown;
    destroyed = false;
    recoveries = 0;
    audioTracks: { name: string; lang?: string; default: boolean; forced: boolean }[] = [];
    subtitleTracks: { name: string; lang?: string; default: boolean; forced: boolean }[] = [];
    audioTrack = -1;
    subtitleTrack = -1;
    subtitleDisplay = true;

    constructor(readonly config: Record<string, unknown>) {
      instances.push(this);
    }

    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }

    emit(event: string, data: unknown = {}) {
      for (const handler of this.handlers.get(event) ?? []) (handler as (event: string, data: unknown) => void)(event, data);
    }

    loadSource(url: string) {
      this.source = url;
    }

    attachMedia(media: unknown) {
      this.media = media;
    }

    recoverMediaError() {
      this.recoveries += 1;
    }

    destroy() {
      this.destroyed = true;
    }
  }
  return { Hls: FakeHls as unknown as typeof Hls, instances };
}

type TransportHandler = (...args: never[]) => void;

export function fakeMpegts(options: { supported?: boolean } = {}) {
  const instances: FakeTransport[] = [];
  class FakeTransport {
    readonly handlers = new Map<string, TransportHandler[]>();
    media: unknown;
    loaded = false;
    destroyed = false;

    constructor(
      readonly source: Record<string, unknown>,
      readonly config: Record<string, unknown>,
    ) {
      instances.push(this);
    }

    on(event: string, handler: TransportHandler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) (handler as (...args: unknown[]) => void)(...args);
    }

    attachMediaElement(media: unknown) {
      this.media = media;
    }

    load() {
      this.loaded = true;
    }

    destroy() {
      this.destroyed = true;
    }
  }
  const FakeMpegts = {
    createPlayer: (source: Record<string, unknown>, config?: Record<string, unknown>) => new FakeTransport(source, config ?? {}),
    getFeatureList: () => ({ mseLivePlayback: options.supported ?? true }),
    Events: { ERROR: 'error' },
    ErrorTypes: { NETWORK_ERROR: 'NetworkError', MEDIA_ERROR: 'MediaError', OTHER_ERROR: 'OtherError' },
  };
  return { Mpegts: FakeMpegts as unknown as typeof Mpegts, instances };
}
