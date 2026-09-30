import type { PlatformId, PlayerProfile } from '@sc/api';

/**
 * What libVLC plays on each platform. It decodes in hardware where the device
 * can and in software where it cannot, so its lists are the formats' own,
 * not the device's. HDR is left out: libVLC 3 shows it washed out on most
 * screens, and a server that transcodes tone-maps it better.
 */
export const PROFILES: Readonly<Partial<Record<PlatformId, PlayerProfile>>> = {
  android: {
    protocols: ['progressive', 'hls', 'dash', 'mpegts'],
    containers: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ts', 'm2ts', 'mpegts', 'flv', 'ogg', 'wmv', 'asf', 'mpeg', 'mpg', 'vob', '3gp'],
    videoCodecs: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4', 'msmpeg4v3', 'vc1', 'wmv3'],
    audioCodecs: ['aac', 'mp3', 'mp2', 'ac3', 'eac3', 'dts', 'truehd', 'opus', 'vorbis', 'flac', 'alac', 'wmav2', 'pcm_s16le', 'pcm_s24le'],
    subtitleFormats: ['srt', 'ass', 'vtt', 'pgs', 'dvdsub', 'dvbsub'],
    maxHeight: 2160,
  },
};
