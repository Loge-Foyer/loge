import { canPlay, headersRef, type MediaPlayer, type PlaybackSource, type PlayerContext, type PlayerEvent } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { createEngine, engineOf } from '../plugins/players/vlc/src/engine';
import { PROFILES } from '../plugins/players/vlc/src/profiles';
import { created, type FakeVlcPlayer } from './support/fake-expo';

const context: PlayerContext = {
  resolveHeaders: async (ref) => {
    if (ref === headersRef('portal')) return { 'User-Agent': 'MAG200', Referer: 'http://portal/c/' };
    if (ref === headersRef('token')) return { Authorization: 'Bearer t' };
    return undefined;
  },
};

function source(overrides: Partial<PlaybackSource> = {}): PlaybackSource {
  return { uri: 'https://server/film.mkv', protocol: 'progressive', container: 'mkv', transcoded: false, live: false, ...overrides };
}

function vlc() {
  const player = createEngine(context);
  const engine = created.at(-1);
  if (!engine) throw new Error('no engine');
  const events: PlayerEvent[] = [];
  player.subscribe((event) => events.push(event));
  return {
    player,
    engine,
    events,
    states: () => events.flatMap((event) => (event.type === 'state' ? [event.state] : [])),
    last: <T extends PlayerEvent['type']>(type: T) => events.filter((event): event is Extract<PlayerEvent, { type: T }> => event.type === type).at(-1),
  };
}

const said = (engine: FakeVlcPlayer, state: string) => engine.emit('state', { state });
const tracks = { audio: [{ id: 1, name: 'Track 1 - [English]' }, { id: 2, name: 'Commentary - [English]' }], subtitles: [{ id: 3, name: 'Track 1 - [German]' }] };

async function playing(player: MediaPlayer, engine: FakeVlcPlayer) {
  await player.load({ source: source() });
  player.play();
  said(engine, 'loading');
  said(engine, 'playing');
}

describe('VLC on Android (libVLC)', () => {
  it('hands libVLC the address, where to start, and the only headers it can send', async () => {
    const { player, engine, states } = vlc();
    await player.load({ source: source({ uri: 'http://portal/live.ts', protocol: 'mpegts', headersRef: headersRef('portal') }), startMs: 90_000 });
    expect(engine.loads).toEqual([{ uri: 'http://portal/live.ts', userAgent: 'MAG200', referrer: 'http://portal/c/', startMs: 90_000 }]);
    expect(states()).toEqual(['idle', 'loading']);

    await player.load({ source: source() });
    expect(engine.loads.at(-1)).toEqual({ uri: 'https://server/film.mkv', userAgent: null, referrer: null, startMs: null });
  });

  it('refuses a stream that needs any other header, loudly', async () => {
    const { player, engine, states, last } = vlc();
    await expect(player.load({ source: source({ headersRef: headersRef('token') }) })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(engine.loads).toEqual([]);
    expect(states().at(-1)).toBe('failed');
    expect(last('error')?.error.code).toBe('INVALID_STATE');
  });

  it('is loading until the first frame, then follows libVLC, telling each state once', async () => {
    const { player, engine, states } = vlc();
    await player.load({ source: source() });
    player.play();
    expect(engine.calls).toEqual(['play']);
    said(engine, 'loading');
    said(engine, 'buffering');
    // libVLC's buffering, done before it plays, reads as paused.
    said(engine, 'paused');
    expect(states()).toEqual(['idle', 'loading']);
    said(engine, 'playing');
    said(engine, 'buffering');
    said(engine, 'playing');
    said(engine, 'playing');
    player.pause();
    said(engine, 'paused');
    expect(engine.calls).toEqual(['play', 'pause']);
    expect(states()).toEqual(['idle', 'loading', 'playing', 'buffering', 'playing', 'paused']);
  });

  it('tells the position with the length, and no length for a live stream', async () => {
    const { player, engine, last } = vlc();
    await playing(player, engine);
    engine.emit('position', { positionMs: 12_000.4, durationMs: 5_400_000 });
    expect(last('position')).toEqual({ type: 'position', positionMs: 12_000, durationMs: 5_400_000 });
    engine.emit('position', { positionMs: 13_000 });
    expect(last('position')).toEqual({ type: 'position', positionMs: 13_000 });
  });

  it('names tracks by libVLC’s ids, tells a list once, and chooses by them', async () => {
    const { player, engine, events } = vlc();
    await playing(player, engine);
    engine.emit('tracks', tracks);
    engine.emit('tracks', tracks);
    const told = events.filter((event) => event.type === 'tracks');
    expect(told).toEqual([
      {
        type: 'tracks',
        audio: [
          { id: 'audio-1', label: 'Track 1 - [English]' },
          { id: 'audio-2', label: 'Commentary - [English]' },
        ],
        subtitles: [{ id: 'subtitle-3', label: 'Track 1 - [German]', format: 'unknown', delivery: 'embedded' }],
      },
    ]);
    player.setAudioTrack('audio-2');
    player.setSubtitleTrack('subtitle-3');
    expect([engine.audioTrack, engine.subtitleTrack]).toEqual([2, 3]);
    player.setSubtitleTrack(null);
    expect(engine.subtitleTrack).toBe(-1);
    expect(() => player.setAudioTrack('audio-9')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('chooses the tracks a load asked for once the stream lists them', async () => {
    const { player, engine } = vlc();
    await player.load({ source: source(), audioTrackId: 'audio-2', subtitleTrackId: 'subtitle-3' });
    player.play();
    engine.emit('tracks', { audio: tracks.audio, subtitles: [] });
    expect([engine.audioTrack, engine.subtitleTrack]).toEqual([2, undefined]);
    engine.emit('tracks', tracks);
    expect(engine.subtitleTrack).toBe(3);
  });

  it('opens an ended stream anew to play it again, from the top or from where it was moved to', async () => {
    const { player, engine, states, last } = vlc();
    await playing(player, engine);
    said(engine, 'ended');
    // libVLC's last word on a finished stream is not a place to scrub to.
    engine.emit('position', { positionMs: 0 });
    player.play();
    expect(engine.calls.at(-1)).toBe('replay 0');
    said(engine, 'loading');
    said(engine, 'playing');
    said(engine, 'ended');
    player.seek(60_000);
    expect(last('position')).toEqual({ type: 'position', positionMs: 60_000 });
    player.pause();
    player.play();
    expect(engine.calls.slice(-1)).toEqual(['replay 60000']);
    expect(engine.calls).not.toContain('seek 60000');
    expect(states()).toEqual(['idle', 'loading', 'playing', 'ended', 'buffering', 'playing', 'ended', 'paused']);
  });

  it('seeks an open stream in place', async () => {
    const { player, engine } = vlc();
    await playing(player, engine);
    player.seek(-5);
    player.seek(30_000);
    expect(engine.calls.slice(-2)).toEqual(['seek 0', 'seek 30000']);
  });

  it('fails with the stream, worth trying again later, and hears nothing more from it', async () => {
    const { player, engine, states, last } = vlc();
    await playing(player, engine);
    engine.emit('error', { message: 'VLC could not play this stream.' });
    said(engine, 'ended');
    expect(states().at(-1)).toBe('failed');
    expect(last('error')?.error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff', message: 'VLC could not play this stream.' });
  });

  it('lets go of libVLC on dispose, and refuses everything after', async () => {
    const { player, engine } = vlc();
    await playing(player, engine);
    expect(engineOf(player)).toBe(engine);
    await player.dispose();
    await player.dispose();
    expect(engine.released).toBe(true);
    expect(engine.listenerCount()).toBe(0);
    expect(engineOf(player)).toBeUndefined();
    expect(() => player.play()).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
    await expect(player.load({ source: source() })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('plays what the built-in player on Android cannot: Matroska with DTS or TrueHD, AV1, raw MPEG-TS', () => {
    const android = PROFILES.android;
    if (!android) throw new Error('no Android profile');
    expect(canPlay(android, source({ videoCodec: 'hevc', audioCodecs: ['dts'], height: 2160 }))).toBe(true);
    expect(canPlay(android, source({ videoCodec: 'h264', audioCodecs: ['truehd'] }))).toBe(true);
    expect(canPlay(android, source({ container: 'webm', videoCodec: 'av1', audioCodecs: ['opus'] }))).toBe(true);
    expect(canPlay(android, source({ uri: 'http://portal/live.ts', protocol: 'mpegts', container: 'ts', live: true }))).toBe(true);
    // Stated no wider than it is.
    expect(android.hdr).toBeUndefined();
    expect(PROFILES.ios).toBeUndefined();
    expect(PROFILES.web).toBeUndefined();
  });
});
