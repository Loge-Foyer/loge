import type { PlatformId, PlayerProfile } from '@sc/api';

/**
 * What each platform's engine plays, stated no wider than it is: a profile
 * that claims too much sends the user to a black screen instead of the player
 * that would have played it. A codec only some devices decode is left out.
 * `container` is a progressive file's; an HLS source states none.
 */
export const PROFILES: Readonly<Partial<Record<PlatformId, PlayerProfile>>> = {
  // AVPlayer: HLS and MP4-family files; raw MPEG-TS only inside HLS.
  ios: {
    protocols: ['progressive', 'hls'],
    containers: ['mp4', 'm4v', 'mov'],
    videoCodecs: ['h264', 'hevc'],
    audioCodecs: ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'flac'],
    subtitleFormats: ['vtt'],
    hdr: ['hdr10', 'hlg', 'dolby-vision'],
    maxHeight: 2160,
  },
  // Media3: DASH and raw MPEG-TS too, and Matroska. AC-3 and AV1 depend on the device, so neither is claimed.
  android: {
    protocols: ['progressive', 'hls', 'dash', 'mpegts'],
    containers: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'ts'],
    videoCodecs: ['h264', 'hevc', 'vp9'],
    audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'],
    subtitleFormats: ['vtt', 'srt'],
    maxHeight: 2160,
  },
  // A browser's <video>, with hls.js where it has no HLS of its own. HEVC plays in some browsers only.
  web: {
    protocols: ['progressive', 'hls'],
    containers: ['mp4', 'm4v', 'webm'],
    videoCodecs: ['h264', 'vp9'],
    audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'],
    subtitleFormats: ['vtt'],
  },
};
