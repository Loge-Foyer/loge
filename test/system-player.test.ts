import {
  AppError,
  canPlay,
  headersRef,
  type MediaPlayer,
  type PlaybackSource,
  type PlayerContext,
  type PlayerEvent,
} from '@sc/api';
import { describe, expect, it, vi } from 'vitest';

import { createEngine as createNativeEngine, engineOf } from '../plugins/players/system/src/engine';
import { createEngine as createWebEngine } from '../plugins/players/system/src/engine.web';
import { PROFILES } from '../plugins/players/system/src/profiles';
import { created, type FakeVideoPlayer } from './support/fake-expo-video';
import { fakeHls, FakeVideoElement } from './support/fake-video';

const context: PlayerContext = {
  resolveHeaders: async (ref) => (ref === headersRef('token') ? { Authorization: 'MediaBrowser Token="t"' } : undefined),
};

function source(overrides: Partial<PlaybackSource> = {}): PlaybackSource {
  return { uri: 'https://server/stream.m3u8', protocol: 'hls', transcoded: false, live: false, ...overrides };
}

function record(player: MediaPlayer) {
  const events: PlayerEvent[] = [];
  player.subscribe((event) => events.push(event));
  return {
    events,
    states: () => events.flatMap((event) => (event.type === 'state' ? [event.state] : [])),
    errors: () => events.flatMap((event) => (event.type === 'error' ? [event.error] : [])),
    last: <T extends PlayerEvent['type']>(type: T) => events.filter((event): event is Extract<PlayerEvent, { type: T }> => event.type === type).at(-1),
  };
}

describe('the built-in player on a phone (expo-video)', () => {
  function native() {
    const player = createNativeEngine(context);
    const engine = created.at(-1);
    if (!engine) throw new Error('no engine');
    return { player, engine, log: record(player) };
  }
  const ready = (engine: FakeVideoPlayer) => engine.emit('statusChange', { status: 'readyToPlay' });

  it('loads off the UI thread with the stream’s type and headers, and starts where asked once ready', async () => {
    const { player, engine, log } = native();
    await player.load({ source: source({ headersRef: headersRef('token') }), startMs: 90_000 });
    expect(engine.sources.at(-1)).toEqual({ uri: 'https://server/stream.m3u8', contentType: 'hls', headers: { Authorization: 'MediaBrowser Token="t"' } });
    // AVPlayer drops a seek made before the stream is ready.
    expect(engine.currentTime).toBe(0);
    ready(engine);
    expect(engine.currentTime).toBe(90);
    expect(log.states()).toEqual(['idle', 'loading', 'paused']);
  });

  it('hands raw MPEG-TS to Media3 as a progressive stream', async () => {
    const { player, engine } = native();
    await player.load({ source: source({ uri: 'https://portal/live.ts', protocol: 'mpegts', container: 'ts', live: true }) });
    expect(engine.sources.at(-1)).toMatchObject({ contentType: 'progressive' });
  });

  it('tells buffering, playing, paused and ended — and plays from the start after the end', async () => {
    const { player, engine, log } = native();
    await player.load({ source: source() });
    player.play();
    // Playing before the stream is ready is not playing yet; ready, it is — the engine's flag comes later.
    engine.emit('playingChange', { isPlaying: true });
    ready(engine);
    // Media3 is not "playing" while it buffers: that is buffering, never a pause.
    engine.emit('statusChange', { status: 'loading' });
    engine.emit('playingChange', { isPlaying: false });
    ready(engine);
    engine.emit('playingChange', { isPlaying: true });
    player.pause();
    engine.emit('playingChange', { isPlaying: false });
    engine.emit('playToEnd');
    engine.currentTime = 600;
    player.play();
    expect(engine.currentTime).toBe(0);
    expect(log.states()).toEqual(['idle', 'loading', 'playing', 'buffering', 'playing', 'paused', 'ended', 'playing']);
  });

  it('pays no attention to the empty player before anything is loaded', () => {
    const { engine, log } = native();
    engine.emit('playToEnd');
    engine.emit('timeUpdate', { currentTime: 0 });
    engine.emit('statusChange', { status: 'idle' });
    expect(log.events).toEqual([{ type: 'state', state: 'idle' }]);
  });

  it('tells the tracks once for each change', async () => {
    const { player, engine, log } = native();
    await player.load({ source: source() });
    const tracks = { availableAudioTracks: [{ language: 'en', label: 'English' }], availableSubtitleTracks: [], availableVideoTracks: [], duration: 0, videoSource: null };
    engine.emit('sourceLoad', tracks);
    engine.emit('availableAudioTracksChange', { availableAudioTracks: tracks.availableAudioTracks });
    expect(log.events.filter((event) => event.type === 'tracks')).toHaveLength(1);
  });

  it('reports the position each second, with a duration unless the stream is live', async () => {
    const { player, engine, log } = native();
    expect(engine.timeUpdateEventInterval).toBe(1);
    await player.load({ source: source() });
    engine.duration = 120;
    engine.emit('timeUpdate', { currentTime: 12.5 });
    expect(log.last('position')).toEqual({ type: 'position', positionMs: 12_500, durationMs: 120_000 });
    Object.assign(engine, { isLive: true });
    engine.emit('timeUpdate', { currentTime: 13 });
    expect(log.last('position')).toEqual({ type: 'position', positionMs: 13_000 });
  });

  it('names tracks by their place and chooses them, and refuses one it does not have', async () => {
    const { player, engine, log } = native();
    await player.load({ source: source() });
    const english = { language: 'en', label: 'English', isDefault: true };
    const german = { language: 'de', label: 'Deutsch' };
    const subtitles = { language: 'en', label: '' , name: 'English SDH' };
    engine.emit('sourceLoad', { availableAudioTracks: [english, german], availableSubtitleTracks: [subtitles], availableVideoTracks: [], duration: 0, videoSource: null });
    expect(log.last('tracks')).toEqual({
      type: 'tracks',
      audio: [
        { id: 'audio-0', label: 'English', language: 'en', default: true },
        { id: 'audio-1', label: 'Deutsch', language: 'de' },
      ],
      subtitles: [{ id: 'subtitle-0', label: 'English SDH', language: 'en', format: 'vtt', delivery: 'embedded' }],
    });
    player.setAudioTrack('audio-1');
    expect(engine.audioTrack).toBe(german);
    player.setSubtitleTrack('subtitle-0');
    expect(engine.subtitleTrack).toBe(subtitles);
    player.setSubtitleTrack(null);
    expect(engine.subtitleTrack).toBeNull();
    expect(() => player.setAudioTrack('audio-7')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('chooses the tracks a load asked for once they are known', async () => {
    const { player, engine } = native();
    await player.load({ source: source(), audioTrackId: 'audio-1', subtitleTrackId: 'subtitle-0' });
    const german = { language: 'de', label: 'Deutsch' };
    const subtitles = { language: 'de', label: 'Deutsch' };
    engine.emit('sourceLoad', { availableAudioTracks: [{ language: 'en', label: 'English' }, german], availableSubtitleTracks: [subtitles], availableVideoTracks: [], duration: 0, videoSource: null });
    ready(engine);
    expect(engine.audioTrack).toBe(german);
    expect(engine.subtitleTrack).toBe(subtitles);
  });

  it('fails loudly: an engine error arrives typed, and a released player refuses everything', async () => {
    const { player, engine, log } = native();
    await player.load({ source: source() });
    engine.emit('statusChange', { status: 'error', error: { message: 'Cannot Open' } });
    expect(log.states().at(-1)).toBe('failed');
    expect(log.errors()).toEqual([expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff', message: 'Cannot Open' })]);

    expect(engineOf(player)).toBe(engine);
    await player.dispose();
    expect(engine.released).toBe(true);
    expect(engine.listenerCount()).toBe(0);
    expect(engineOf(player)).toBeUndefined();
    expect(() => player.play()).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
    await expect(player.load({ source: source() })).rejects.toBeInstanceOf(AppError);
  });

  it('fails the load when the engine cannot take the source', async () => {
    const { player, engine, log } = native();
    engine.replaceAsync = async () => {
      throw new Error('bad url');
    };
    await expect(player.load({ source: source() })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(log.states().at(-1)).toBe('failed');
  });
});

describe('the built-in player in a browser (<video>, hls.js)', () => {
  function web(options: { nativeHls?: boolean; supported?: boolean; hlsFails?: boolean } = {}) {
    const video = new FakeVideoElement();
    video.nativeHls = options.nativeHls ?? false;
    const hls = fakeHls({ supported: options.supported ?? true });
    const loadHls = vi.fn(async () => {
      if (options.hlsFails) throw new Error('chunk failed');
      return hls.Hls;
    });
    const player = createWebEngine(context, { createVideo: () => video as unknown as HTMLVideoElement, loadHls });
    return { player, video, hls, loadHls, log: record(player) };
  }

  it('plays HLS through hls.js, without a worker, from where it is asked to start', async () => {
    const { player, video, hls, loadHls, log } = web();
    await player.load({ source: source(), startMs: 30_000 });
    const [instance] = hls.instances;
    expect(loadHls).toHaveBeenCalledOnce();
    expect(instance?.config).toEqual({ enableWorker: false, startPosition: 30 });
    expect(instance?.source).toBe('https://server/stream.m3u8');
    expect(instance?.media).toBe(video);
    // hls.js seeks there itself; the metadata must not seek again.
    video.fire('loadedmetadata');
    expect(video.currentTime).toBe(0);
    expect(log.states()).toEqual(['idle', 'loading']);
  });

  it('uses the browser’s own HLS where it has one — and hls.js when the stream needs a header', async () => {
    const plain = web({ nativeHls: true });
    await plain.player.load({ source: source() });
    expect(plain.video.src).toBe('https://server/stream.m3u8');
    expect(plain.loadHls).not.toHaveBeenCalled();

    const signed = web({ nativeHls: true });
    await signed.player.load({ source: source({ headersRef: headersRef('token') }) });
    const setup = signed.hls.instances[0]?.config.xhrSetup as (xhr: { setRequestHeader: (name: string, value: string) => void }) => void;
    const xhr = { setRequestHeader: vi.fn() };
    setup(xhr);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'MediaBrowser Token="t"');
  });

  it('refuses what a <video> cannot do, loudly: a header on a file, raw MPEG-TS, HLS without MSE', async () => {
    const withHeader = web();
    await expect(withHeader.player.load({ source: source({ protocol: 'progressive', uri: 'https://server/film.mp4', headersRef: headersRef('token') }) })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(withHeader.log.errors()).toHaveLength(1);
    expect(withHeader.log.states().at(-1)).toBe('failed');
    await expect(web().player.load({ source: source({ protocol: 'mpegts' }) })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(web({ supported: false }).player.load({ source: source() })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(web({ hlsFails: true }).player.load({ source: source() })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('maps hls.js’s fatal errors — a refusal, a missing stream — and recovers a media error once', async () => {
    const refused = web();
    await refused.player.load({ source: source() });
    refused.hls.instances[0]?.emit('hlsError', { fatal: false, type: 'networkError', response: { code: 500 } });
    expect(refused.log.errors()).toEqual([]);
    refused.hls.instances[0]?.emit('hlsError', { fatal: true, type: 'networkError', response: { code: 401 } });
    expect(refused.log.errors()).toEqual([expect.objectContaining({ code: 'UNAUTHORIZED', retry: 'never' })]);

    const missing = web();
    await missing.player.load({ source: source() });
    missing.hls.instances[0]?.emit('hlsError', { fatal: true, type: 'networkError', response: { code: 404 } });
    expect(missing.log.errors()).toEqual([expect.objectContaining({ code: 'NOT_FOUND' })]);

    const media = web();
    await media.player.load({ source: source() });
    const instance = media.hls.instances[0];
    instance?.emit('hlsError', { fatal: true, type: 'mediaError' });
    expect(instance?.recoveries).toBe(1);
    expect(media.log.errors()).toEqual([]);
    instance?.emit('hlsError', { fatal: true, type: 'mediaError' });
    expect(media.log.errors()).toEqual([expect.objectContaining({ code: 'INVALID_STATE' })]);
  });

  it('maps the element’s own errors, and takes an aborted load for nothing', async () => {
    const { player, video, log } = web();
    await player.load({ source: source({ protocol: 'progressive', uri: 'https://server/film.mp4' }) });
    expect(video.src).toBe('https://server/film.mp4');
    video.failWith(1);
    expect(log.errors()).toEqual([]);
    video.failWith(2);
    expect(log.errors()).toEqual([expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' })]);
    await player.load({ source: source({ protocol: 'progressive', uri: 'https://server/film.mp4' }) });
    video.failWith(3);
    expect(log.errors().at(-1)).toMatchObject({ code: 'INVALID_STATE' });
  });

  it('tells states and the position once a second, and starts a file where asked', async () => {
    const { player, video, log } = web();
    await player.load({ source: source({ protocol: 'progressive', uri: 'https://server/film.mp4' }), startMs: 5_000 });
    video.duration = 60;
    video.fire('loadedmetadata');
    expect(video.currentTime).toBe(5);
    player.play();
    video.fire('playing');
    video.fire('waiting');
    video.fire('canplay');
    video.currentTime = 5.4;
    video.fire('timeupdate');
    const positions = () => log.events.filter((event) => event.type === 'position').length;
    const before = positions();
    video.currentTime = 5.8;
    video.fire('timeupdate');
    expect(positions()).toBe(before);
    video.currentTime = 6.1;
    video.fire('timeupdate');
    expect(log.last('position')).toEqual({ type: 'position', positionMs: 6_100, durationMs: 60_000 });
    player.pause();
    video.fire('pause');
    player.play();
    video.fire('playing');
    // At the end the browser pauses, then ends: that is no pause.
    video.ended = true;
    video.fire('pause');
    video.fire('ended');
    expect(log.states()).toEqual(['idle', 'loading', 'playing', 'buffering', 'playing', 'paused', 'playing', 'ended']);
  });

  it('takes a play the browser refused without a tap for a pause, not a failure', async () => {
    const { player, video, log } = web();
    await player.load({ source: source({ protocol: 'progressive', uri: 'https://server/film.mp4' }) });
    video.playResult = () => Promise.reject(Object.assign(new Error('needs a gesture'), { name: 'NotAllowedError' }));
    player.play();
    await vi.waitFor(() => expect(log.states().at(-1)).toBe('paused'));
    expect(log.errors()).toEqual([]);
  });

  it('lets go of hls.js and the element, and refuses everything after', async () => {
    const { player, video, hls } = web();
    await player.load({ source: source() });
    await player.dispose();
    expect(hls.instances[0]?.destroyed).toBe(true);
    expect(video.src).toBe('');
    expect(video.removed).toBe(true);
    expect(() => player.play()).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });
});

describe('the built-in player’s profiles', () => {
  const transportStream = source({ uri: 'https://portal/live.ts', protocol: 'mpegts', container: 'ts', videoCodec: 'h264', audioCodecs: ['aac'], live: true });
  const film = source({ uri: 'https://server/film.mkv', protocol: 'progressive', container: 'mkv', videoCodec: 'hevc', audioCodecs: ['eac3', 'aac'] });
  const hls = source({ videoCodec: 'h264', audioCodecs: ['aac'] });

  it('say what each platform plays: HLS everywhere, MPEG-TS and Matroska on Android only', () => {
    const { ios, android, web } = PROFILES;
    if (!ios || !android || !web) throw new Error('a platform has no profile');
    expect([ios, android, web].map((profile) => canPlay(profile, hls))).toEqual([true, true, true]);
    expect([ios, android, web].map((profile) => canPlay(profile, transportStream))).toEqual([false, true, false]);
    expect([ios, android, web].map((profile) => canPlay(profile, film))).toEqual([false, true, false]);
  });
});
