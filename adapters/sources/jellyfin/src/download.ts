import type { DownloadDescriptor, DownloadOption, DownloadQuality, DownloadSubtitle, HdrFormat, MediaVersion } from '@sc/api';

import type { MediaSourceDto } from './dto';
import { hdrOf, ours } from './playback';

/**
 * Keeping a copy, as against playing one. The two differ in what they ask the
 * server for: playback wants whatever this engine can open right now, and a
 * download wants one file, small enough to be worth the space, that any
 * engine on this device will still open in a month.
 */

/** Rungs worth offering when the server is willing to transcode. */
const RUNGS: readonly { readonly height: number; readonly bitrate: number }[] = [
  { height: 2160, bitrate: 40_000_000 },
  { height: 1080, bitrate: 8_000_000 },
  { height: 720, bitrate: 4_000_000 },
  { height: 480, bitrate: 1_500_000 },
  { height: 360, bitrate: 800_000 },
];

export const DOWNLOAD_OPTION_ORIGINAL = 'original';

/**
 * A transcode's size, from its bitrate and how long it runs. Jellyfin cannot
 * know it in advance either — it is encoding as it sends — so this is the
 * same arithmetic anyone would do by hand, and is labelled an estimate
 * wherever it is shown.
 */
function estimate(bitrate: number, durationMs: number | undefined): number | undefined {
  if (durationMs === undefined || durationMs <= 0) return undefined;
  return Math.round((bitrate / 8) * (durationMs / 1000));
}

/**
 * What this item can be kept as: the file the server already holds, and the
 * rungs below it that it would make. Rungs taller than the file are left out —
 * a server upscaling a 720p file to 4K would cost space and gain nothing.
 */
export function downloadOptions(sources: readonly MediaSourceDto[], versions: readonly MediaVersion[]): readonly DownloadOption[] {
  const options: DownloadOption[] = [];
  for (const [index, source] of sources.entries()) {
    const version = versions[index];
    const video = version?.video;
    const durationMs = version?.durationMs;
    options.push({
      id: originalId(source.id),
      ...(version?.label === undefined ? {} : { label: version.label }),
      ...(video?.height === undefined ? {} : { height: video.height }),
      ...(source.bitrate === undefined ? {} : { bitrate: source.bitrate }),
      ...(source.size === undefined ? {} : { estimatedBytes: source.size }),
      ...(version?.container === undefined ? {} : { container: version.container }),
      ...(video?.codec === undefined ? {} : { videoCodec: video.codec }),
      ...(version && version.audio.length > 0
        ? { audioCodecs: version.audio.flatMap((track) => (track.codec === undefined ? [] : [track.codec])) }
        : {}),
      ...(video?.hdr === undefined ? {} : { hdr: video.hdr }),
      transcoded: false,
    });
    // Only the first file gets rungs: offering five sizes of each of three
    // files is a wall of choices, and the first is the one the server plays.
    if (index > 0) continue;
    for (const rung of RUNGS) {
      if (video?.height !== undefined && rung.height >= video.height) continue;
      const bytes = estimate(rung.bitrate, durationMs);
      options.push({
        id: `${source.id}|${rung.height}`,
        height: rung.height,
        bitrate: rung.bitrate,
        ...(bytes === undefined ? {} : { estimatedBytes: bytes }),
        container: 'mp4',
        videoCodec: 'h264',
        audioCodecs: ['aac'],
        transcoded: true,
      });
    }
  }
  return options;
}

/** The chosen option, read back into something to ask the server for. */
export function parseOption(optionId: string | undefined, quality: DownloadQuality | undefined): {
  readonly mediaSourceId?: string;
  readonly quality: DownloadQuality;
} {
  if (optionId !== undefined) {
    const [sourceId = '', height] = optionId.split('|');
    const original = sourceId.endsWith(`:${DOWNLOAD_OPTION_ORIGINAL}`);
    const mediaSourceId = original ? sourceId.slice(0, -`:${DOWNLOAD_OPTION_ORIGINAL}`.length) : sourceId;
    if (original || height === undefined) {
      // The file as it is: no ceiling, so the server has no reason to re-encode.
      return { mediaSourceId, quality: { hdr: true } };
    }
    const rung = RUNGS.find((candidate) => String(candidate.height) === height);
    return {
      mediaSourceId,
      quality: { hdr: false, maxHeight: Number(height), ...(rung ? { maxBitrate: rung.bitrate } : {}) },
    };
  }
  return { quality: quality ?? { hdr: true } };
}

const originalId = (sourceId: string) => `${sourceId}:${DOWNLOAD_OPTION_ORIGINAL}`;

/**
 * A profile for keeping rather than playing. It says "one progressive file,
 * mp4, H.264 and AAC" so that whatever arrives is a single file every engine
 * on this device opens — HLS would be a playlist and a folder of segments,
 * which is not something to keep.
 *
 * Where the quality asks for nothing, the file's own codecs are listed as
 * direct-play, so the server hands over what it has rather than re-encoding.
 */
export function downloadProfile(quality: DownloadQuality, version: MediaVersion | undefined): Readonly<Record<string, unknown>> {
  const ceiling = quality.maxBitrate ?? 120_000_000;
  const direct = quality.maxHeight === undefined && quality.maxBitrate === undefined;
  const containers = direct ? unique([version?.container ?? 'mp4', 'mp4', 'mkv']) : ['mp4'];
  const videoCodecs = direct ? unique([version?.video?.codec ?? 'h264', 'h264', 'hevc']) : ['h264'];
  const audioCodecs = direct
    ? unique([...(version?.audio ?? []).flatMap((track) => (track.codec === undefined ? [] : [track.codec])), 'aac'])
    : ['aac'];
  return {
    Name: 'Streaming Center (download)',
    MaxStreamingBitrate: ceiling,
    MaxStaticBitrate: ceiling,
    DirectPlayProfiles: containers.map((container) => ({
      Container: container,
      Type: 'Video',
      VideoCodec: videoCodecs.join(','),
      AudioCodec: audioCodecs.join(','),
    })),
    // Http, never hls: a download is one file.
    TranscodingProfiles: [
      {
        Container: 'mp4',
        Type: 'Video',
        VideoCodec: 'h264',
        AudioCodec: 'aac',
        Protocol: 'http',
        Context: 'Static',
        MaxAudioChannels: '6',
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      {
        Type: 'Video',
        Conditions: [
          ...(quality.hdr ? [] : [{ Condition: 'EqualsAny', Property: 'VideoRangeType', Value: 'SDR', IsRequired: false }]),
          ...(quality.maxHeight ? [{ Condition: 'LessThanEqual', Property: 'Height', Value: String(quality.maxHeight), IsRequired: false }] : []),
          ...(quality.maxBitDepth ? [{ Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: String(quality.maxBitDepth), IsRequired: false }] : []),
        ],
      },
    ],
    // Kept inside the file, so one file is the whole of it.
    SubtitleProfiles: [{ Format: 'srt', Method: 'Embed' }, { Format: 'ass', Method: 'Embed' }, { Format: 'pgssub', Method: 'Embed' }],
  };
}

/** Subtitles the server keeps outside the file, which come down beside it. */
export function externalSubtitles(source: MediaSourceDto, baseUrl: string): readonly DownloadSubtitle[] {
  return source.mediaStreams.flatMap((stream) =>
    stream.type === 'Subtitle' && stream.deliveryUrl
      ? [
          {
            id: String(stream.index),
            uri: /^[a-z]+:\/\//i.test(stream.deliveryUrl) ? stream.deliveryUrl : baseUrl + stream.deliveryUrl,
            ...(stream.codec === undefined ? {} : { format: stream.codec.toLowerCase() }),
            ...(stream.language === undefined ? {} : { language: stream.language }),
            ...(stream.displayTitle === undefined ? {} : { label: stream.displayTitle }),
            ...(stream.isForced ? { forced: true } : {}),
            delivery: 'external' as const,
          },
        ]
      : [],
  );
}

/**
 * The extension to give the file on disk. Jellyfin reports ffprobe's family
 * list — `mov,mp4,m4a,3gp,3g2,mj2` — and the first of it is `mov`, which is
 * the least likely truth: anything in that family is an MP4 in practice, and
 * the OS matches on the extension. Outside it, the first name is the name.
 */
export function downloadContainer(reported: string | undefined): string {
  if (!reported) return 'mp4';
  const names = reported.toLowerCase().split(',').map((name) => name.trim()).filter(Boolean);
  if (names.some((name) => ['mov', 'mp4', 'm4v', 'm4a', '3gp', '3g2', 'mj2'].includes(name))) return 'mp4';
  if (names.includes('matroska') || names.includes('webm')) return names.includes('webm') ? 'webm' : 'mkv';
  return names[0] ?? 'mp4';
}

/** What a chosen source says about itself, for the descriptor. */
export function describe(source: MediaSourceDto): {
  readonly videoCodec?: string;
  readonly audioCodecs?: readonly string[];
  readonly height?: number;
  readonly hdr?: HdrFormat;
} {
  const video = source.mediaStreams.find((stream) => stream.type === 'Video');
  const audio = source.mediaStreams.flatMap((stream) =>
    stream.type === 'Audio' && stream.codec ? [ours(stream.codec)] : [],
  );
  const hdr = hdrOf(video?.videoRangeType);
  return {
    ...(video?.codec === undefined ? {} : { videoCodec: ours(video.codec) }),
    ...(audio.length === 0 ? {} : { audioCodecs: audio }),
    ...(video?.height === undefined ? {} : { height: video.height }),
    ...(hdr === undefined ? {} : { hdr }),
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export type { DownloadDescriptor };
