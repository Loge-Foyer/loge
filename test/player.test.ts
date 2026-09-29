import { canPlay, choosePlayer, missingFor, pluginId, type PlaybackSource, type PlayerProfile } from '@sc/api';
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
