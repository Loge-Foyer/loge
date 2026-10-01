import {
  AppError,
  canPlay,
  choosePlayer,
  createPlayerEvents,
  missingFor,
  playbackFailed,
  pluginId,
  type PlaybackSource,
  type PlayerEvent,
  type PlayerProfile,
} from '@sc/api';
import { describe, expect, it } from 'vitest';

// Rough shapes of the engines, enough to exercise the rules.
const avplayer: PlayerProfile = {
  protocols: ['progressive', 'hls'],
  containers: ['mp4', 'mov', 'm4v', 'ts'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3', 'eac3'],
  subtitleFormats: ['vtt'],
  maxHeight: 2160,
};
const mpv: PlayerProfile = {
  protocols: ['progressive', 'hls', 'mpegts'],
  containers: ['mp4', 'mkv', 'webm', 'ts', 'avi'],
  videoCodecs: ['h264', 'hevc', 'av1', 'vp9', 'mpeg2'],
  audioCodecs: ['aac', 'ac3', 'eac3', 'dts', 'truehd', 'opus', 'flac'],
  subtitleFormats: ['srt', 'vtt', 'ass', 'pgs'],
};

function source(overrides: Partial<PlaybackSource>): PlaybackSource {
  return { uri: 'http://server/stream', protocol: 'progressive', transcoded: false, live: false, ...overrides };
}

const system = pluginId('players/system');
const mpvId = pluginId('players/mpv');

describe('canPlay', () => {
  it('plays what the engine supports', () => {
    expect(canPlay(avplayer, source({ protocol: 'hls', container: 'ts', videoCodec: 'h264', audioCodecs: ['aac'] }))).toBe(true);
  });

  it('names everything an engine lacks', () => {
    expect(missingFor(avplayer, source({ container: 'mkv', videoCodec: 'av1', audioCodecs: ['dts', 'truehd'] }))).toEqual([
      'container',
      'videoCodec',
      'audioCodec',
    ]);
    expect(missingFor(avplayer, source({ protocol: 'mpegts', live: true }))).toEqual(['protocol']);
    expect(missingFor(avplayer, source({ height: 4320 }))).toEqual(['height']);
  });

  it('needs only one playable audio track', () => {
    expect(canPlay(avplayer, source({ audioCodecs: ['dts', 'aac'] }))).toBe(true);
  });

  it('does not judge what the source leaves unsaid', () => {
    expect(canPlay(avplayer, source({}))).toBe(true);
  });
});

describe('a stream’s container', () => {
  it('is judged for a progressive file only: a stream’s protocol says what it is', () => {
    const browser: PlayerProfile = { ...avplayer, protocols: ['progressive', 'hls', 'mpegts'], containers: ['mp4'] };
    const live: PlaybackSource = { uri: 'http://portal/live.ts', protocol: 'mpegts', container: 'ts', transcoded: false, live: true };
    expect(missingFor(browser, live)).toEqual([]);
    expect(missingFor(browser, { ...live, protocol: 'progressive', live: false })).toEqual(['container']);
  });
});

describe('choosePlayer', () => {
  const mkv = source({ container: 'mkv', videoCodec: 'hevc', audioCodecs: ['dts'] });
  const hls = source({ protocol: 'hls', container: 'ts', videoCodec: 'h264', audioCodecs: ['aac'], transcoded: true });

  it('takes the preferred player when it can play something', () => {
    const choice = choosePlayer([mkv, hls], [
      { id: system, profile: avplayer },
      { id: mpvId, profile: mpv },
    ], mpvId);
    expect(choice).toEqual({ kind: 'play', player: mpvId, source: mkv });
  });

  it('falls back in order when the preferred player cannot', () => {
    const choice = choosePlayer([mkv], [
      { id: system, profile: avplayer },
      { id: mpvId, profile: mpv },
    ], system);
    expect(choice).toEqual({ kind: 'play', player: mpvId, source: mkv });
  });

  it('tries the sources best first, per player', () => {
    const choice = choosePlayer([mkv, hls], [{ id: system, profile: avplayer }]);
    expect(choice).toEqual({ kind: 'play', player: system, source: hls });
  });

  it('says when no enabled player can', () => {
    expect(choosePlayer([mkv], [{ id: system, profile: avplayer }])).toEqual({ kind: 'none' });
    expect(choosePlayer([hls], [])).toEqual({ kind: 'none' });
  });
});

describe('createPlayerEvents', () => {
  it('tells a state once, and a new listener the current one at once', () => {
    const events = createPlayerEvents();
    const early: PlayerEvent[] = [];
    events.subscribe((event) => early.push(event));
    events.setState('loading');
    events.setState('loading');
    events.setState('playing');
    const late: PlayerEvent[] = [];
    const unsubscribe = events.subscribe((event) => late.push(event));
    expect(early).toEqual([
      { type: 'state', state: 'idle' },
      { type: 'state', state: 'loading' },
      { type: 'state', state: 'playing' },
    ]);
    expect(late).toEqual([{ type: 'state', state: 'playing' }]);
    unsubscribe();
    events.setState('paused');
    expect(late).toHaveLength(1);
  });

  it('makes a failure a state and an error both', () => {
    const events = createPlayerEvents();
    const heard: PlayerEvent[] = [];
    events.subscribe((event) => heard.push(event));
    const error = playbackFailed('   ');
    events.fail(error);
    expect(heard.slice(1)).toEqual([{ type: 'state', state: 'failed' }, { type: 'error', error }]);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff', message: 'The stream could not be played.' });
    events.clear();
    events.setState('idle');
    expect(heard).toHaveLength(3);
  });
});
