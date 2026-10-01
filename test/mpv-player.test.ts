import { canPlay, headersRef, type MediaPlayer, type PlaybackSource, type PlayerContext, type PlayerEvent } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { createEngine, engineOf } from '../plugins/players/mpv/src/engine';
import { PROFILES } from '../plugins/players/mpv/src/profiles';
import { createdMpv, type FakeMpvPlayer } from './support/fake-expo';

const context: PlayerContext = {
  resolveHeaders: async (ref) => {
    if (ref === headersRef('portal')) return { 'User-Agent': 'MAG200', Referer: 'http://portal/c/', Cookie: 'mac=00:1A:79:AA:BB:CC; stb_lang=en' };
    return undefined;
  },
};

function source(overrides: Partial<PlaybackSource> = {}): PlaybackSource {
  return { uri: 'https://server/film.mkv', protocol: 'progressive', container: 'mkv', transcoded: false, live: false, ...overrides };
}

function mpv(overrides: { preferences?: { softwareFallback: boolean } } = {}) {
  const player = createEngine({ ...context, ...(overrides.preferences ? { preferences: overrides.preferences } : {}) });
  const engine = createdMpv.at(-1);
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

const said = (engine: FakeMpvPlayer, state: string) => engine.emit('state', { state });
const tracks = {
  audio: [
    { id: 1, title: 'Surround', language: 'eng', codec: 'eac3' },
    { id: 2, language: 'ger', codec: 'aac' },
  ],
  subtitles: [{ id: 3, language: 'ger', codec: 'subrip' }, { id: 4, codec: 'hdmv_pgs_subtitle' }],
};

async function playing(player: MediaPlayer, engine: FakeMpvPlayer) {
  await player.load({ source: source() });
  player.play();
  said(engine, 'loading');
  said(engine, 'playing');
}

describe('mpv on Android (libmpv)', () => {
  it('hands mpv the address, where to start, and every header the stream needs', async () => {
    const { player, engine, states } = mpv();
    await player.load({ source: source({ uri: 'http://portal/live.ts', protocol: 'mpegts', headersRef: headersRef('portal') }), startMs: 90_000 });
    expect(engine.loads).toEqual([
      {
        uri: 'http://portal/live.ts',
        // A portal's cookie is a header no other engine here can send.
        headers: { 'User-Agent': 'MAG200', Referer: 'http://portal/c/', Cookie: 'mac=00:1A:79:AA:BB:CC; stb_lang=en' },
        startMs: 90_000,
      },
    ]);
    expect(states()).toEqual(['idle', 'loading']);

    await player.load({ source: source() });
    expect(engine.loads.at(-1)).toEqual({ uri: 'https://server/film.mkv', headers: null, startMs: null });
  });

  it('follows mpv’s states, telling each once', async () => {
    const { player, engine, states } = mpv();
    await player.load({ source: source() });
    player.play();
    expect(engine.calls).toEqual(['play']);
    said(engine, 'loading');
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
    const { player, engine, last } = mpv();
    await playing(player, engine);
    engine.emit('position', { positionMs: 12_000.4, durationMs: 5_400_000 });
    expect(last('position')).toEqual({ type: 'position', positionMs: 12_000, durationMs: 5_400_000 });
    engine.emit('position', { positionMs: 13_000 });
    expect(last('position')).toEqual({ type: 'position', positionMs: 13_000 });
  });

  it('names tracks as the file does — language and codec included — tells a list once, and chooses by mpv’s ids', async () => {
    const { player, engine, events } = mpv();
    await playing(player, engine);
    engine.emit('tracks', tracks);
    engine.emit('tracks', tracks);
    const told = events.filter((event) => event.type === 'tracks');
    expect(told).toEqual([
      {
        type: 'tracks',
        audio: [
          { id: 'audio-1', label: 'Surround', language: 'eng', codec: 'eac3' },
          { id: 'audio-2', label: 'ger', language: 'ger', codec: 'aac' },
        ],
        subtitles: [
          { id: 'subtitle-3', label: 'ger', format: 'srt', delivery: 'embedded', language: 'ger' },
          { id: 'subtitle-4', label: 'Subtitles 4', format: 'pgs', delivery: 'embedded' },
        ],
      },
    ]);
    player.setAudioTrack('audio-2');
    player.setSubtitleTrack('subtitle-3');
    expect([engine.audioTrack, engine.subtitleTrack]).toEqual([2, 3]);
    player.setSubtitleTrack(null);
    expect(engine.subtitleTrack).toBe(-1);
    expect(() => player.setAudioTrack('audio-9')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('chooses the tracks a load asked for once the file lists them', async () => {
    const { player, engine } = mpv();
    await player.load({ source: source(), audioTrackId: 'audio-2', subtitleTrackId: 'subtitle-3' });
    player.play();
    engine.emit('tracks', { audio: tracks.audio, subtitles: [] });
    expect([engine.audioTrack, engine.subtitleTrack]).toEqual([2, undefined]);
    engine.emit('tracks', tracks);
    expect(engine.subtitleTrack).toBe(3);
  });

  it('plays an ended file again from the top, or from where it was moved to', async () => {
    const { player, engine, states, last } = mpv();
    await playing(player, engine);
    said(engine, 'ended');
    // mpv's last word on a finished file is not a place to scrub to.
    engine.emit('position', { positionMs: 0 });
    player.play();
    expect(engine.calls.at(-1)).toBe('replay 0');
    said(engine, 'playing');
    said(engine, 'ended');
    player.seek(60_000);
    expect(last('position')).toEqual({ type: 'position', positionMs: 60_000 });
    player.pause();
    player.play();
    expect(engine.calls.slice(-1)).toEqual(['replay 60000']);
    expect(engine.calls).not.toContain('seek 60000');
    expect(states()).toEqual(['idle', 'loading', 'playing', 'ended', 'playing', 'ended', 'paused']);
  });

  it('seeks an open file in place', async () => {
    const { player, engine } = mpv();
    await playing(player, engine);
    player.seek(-5);
    player.seek(30_000);
    expect(engine.calls.slice(-2)).toEqual(['seek 0', 'seek 30000']);
  });

  it('fails with the stream, worth trying again later, and hears nothing more from it', async () => {
    const { player, engine, states, last } = mpv();
    await playing(player, engine);
    engine.emit('error', { message: 'mpv could not play this stream.' });
    said(engine, 'ended');
    expect(states().at(-1)).toBe('failed');
    expect(last('error')?.error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff', message: 'mpv could not play this stream.' });
  });

  it('lets go of mpv on dispose, and refuses everything after', async () => {
    const { player, engine } = mpv();
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

  it('plays what the built-in player cannot: Matroska with DTS or TrueHD, AV1, raw MPEG-TS', () => {
    for (const [platform, profile] of Object.entries(PROFILES)) {
      if (!profile) throw new Error(`no ${platform} profile`);
      expect(canPlay(profile, source({ videoCodec: 'hevc', audioCodecs: ['dts'], height: 1080 }))).toBe(true);
      expect(canPlay(profile, source({ videoCodec: 'h264', audioCodecs: ['truehd'] }))).toBe(true);
      expect(canPlay(profile, source({ container: 'webm', videoCodec: 'av1', audioCodecs: ['opus'] }))).toBe(true);
      expect(canPlay(profile, source({ uri: 'http://portal/live.ts', protocol: 'mpegts', container: 'ts', live: true }))).toBe(true);
      // HDR waits for a screen to judge it on, on either phone.
      expect(profile.hdr).toBeUndefined();
    }
    // There is no mpv for a browser.
    expect(PROFILES.web).toBeUndefined();
  });

  it('claims 4K where the decoder earns it, and not where it does not', () => {
    const { ios, android } = PROFILES;
    if (!ios || !android) throw new Error('both phones');
    // Android decodes in software (see android/), so 4K goes to another player
    // or comes back from the source as 1080p.
    expect(canPlay(android, source({ videoCodec: 'hevc', height: 2160 }))).toBe(false);
    // VideoToolbox does H.264 and HEVC in hardware on every iPhone this app
    // runs on, and mpv falls back to software for the rest.
    expect(canPlay(ios, source({ videoCodec: 'hevc', height: 2160 }))).toBe(true);
    // The height is the only thing the two differ on.
    expect({ ...ios, maxHeight: 0 }).toEqual({ ...android, maxHeight: 0 });
  });

  it('plays faster and slower, and clamps a rate no engine honours', async () => {
    const { player, engine } = mpv();
    await playing(player, engine);
    player.setRate?.(1.5);
    expect(engine.rate).toBe(1.5);
    // Outside what an engine will play, every engine clamps the same way.
    player.setRate?.(99);
    expect(engine.rate).toBe(4);
    player.setRate?.(0);
    expect(engine.rate).toBe(0.25);
  });

  it('is told whether it may fall back to software, before anything is loaded', async () => {
    // On by default: a picture is better than none.
    const { engine } = mpv();
    expect(engine.softwareFallback).toBe(true);

    // Off refuses a stream the hardware decoder will not take, rather than
    // decoding it in software and saying nothing about the battery.
    const strict = mpv({ preferences: { softwareFallback: false } });
    expect(strict.engine.softwareFallback).toBe(false);
  });
});
