import type { PlatformId, PlayerProfile } from '@sc/api';

/**
 * What mpv plays on each platform. FFmpeg decodes the formats themselves, in
 * hardware where the device can and in software where it cannot, so the lists
 * are the formats' own. HDR is left out until it has been seen on an HDR
 * screen: mpv tone-maps, but how well depends on the device.
 *
 * The two phones differ only in how tall a picture they claim, and for a
 * reason that is about the decoder rather than the engine — see each.
 */
export const PROFILES: Readonly<Partial<Record<PlatformId, PlayerProfile>>> = {
  ios: {
    protocols: ['progressive', 'hls', 'dash', 'mpegts'],
    containers: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ts', 'm2ts', 'mpegts', 'flv', 'ogg', 'wmv', 'asf', 'mpeg', 'mpg', 'vob', '3gp'],
    videoCodecs: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4', 'msmpeg4v3', 'vc1', 'wmv3'],
    audioCodecs: ['aac', 'mp3', 'mp2', 'ac3', 'eac3', 'dts', 'truehd', 'opus', 'vorbis', 'flac', 'alac', 'wmav2', 'pcm_s16le', 'pcm_s24le'],
    // libass draws the text ones, so ASS keeps its styling.
    subtitleFormats: ['srt', 'ass', 'vtt', 'pgs', 'dvdsub', 'dvbsub'],
    // VideoToolbox decodes H.264 and HEVC in hardware on every iPhone this
    // app runs on, and mpv falls back to FFmpeg's own decoders for the rest
    // (`hwdec-software-fallback`), so the height is the screen's rather than
    // the decoder's. Android claims less, and says why.
    maxHeight: 2160,
  },
  android: {
    protocols: ['progressive', 'hls', 'dash', 'mpegts'],
    containers: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ts', 'm2ts', 'mpegts', 'flv', 'ogg', 'wmv', 'asf', 'mpeg', 'mpg', 'vob', '3gp'],
    videoCodecs: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4', 'msmpeg4v3', 'vc1', 'wmv3'],
    audioCodecs: ['aac', 'mp3', 'mp2', 'ac3', 'eac3', 'dts', 'truehd', 'opus', 'vorbis', 'flac', 'alac', 'wmav2', 'pcm_s16le', 'pcm_s24le'],
    // libass draws the text ones, so ASS keeps its styling.
    subtitleFormats: ['srt', 'ass', 'vtt', 'pgs', 'dvdsub', 'dvbsub'],
    // Software decoding, for now (see android/): 1080p is what a phone keeps up
    // with, and a source that transcodes will send that instead of 4K.
    maxHeight: 1080,
  },
};
