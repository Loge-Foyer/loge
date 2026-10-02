import {
  AppError,
  type AudioTrack,
  type Chapter,
  type HdrFormat,
  type MediaSegment,
  type MediaSegmentKind,
  type PlaybackDescriptor,
  type PlaybackRequest,
  type PlaybackSource,
  type PlayerProfile,
  type SubtitleDelivery,
  type SubtitleTrack,
} from '@loge/api';

import type { MediaSourceDto, MediaStreamDto, PlaybackInfoDto } from './dto';
import { bcp47 } from './languages';
import { queryString } from './url';

export const TICKS_PER_MS = 10_000;

/** What reports need to name the playback they belong to. Held in memory; lost with the app, which reports manage without. */
export interface PlaySession {
  readonly mediaSourceId: string;
  readonly playSessionId?: string;
  readonly playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
  readonly audioStreamIndex?: number;
  readonly subtitleStreamIndex?: number;
}

// The range types each HDR format plays. Dolby Vision with an HDR10, HLG or
// SDR base layer plays as that base layer on an engine without Dolby Vision.
const RANGE_TYPES: Readonly<Record<HdrFormat, readonly string[]>> = {
  hdr10: ['HDR10', 'HDR10Plus', 'DOVIWithHDR10', 'DOVIWithHDR10Plus'],
  'hdr10+': ['HDR10Plus', 'DOVIWithHDR10Plus'],
  hlg: ['HLG', 'DOVIWithHLG'],
  'dolby-vision': ['DOVI', 'DOVIWithHDR10', 'DOVIWithHLG', 'DOVIWithSDR', 'DOVIWithHDR10Plus', 'DOVIWithEL', 'DOVIWithELHDR10Plus'],
};

// Jellyfin's names beside ours; an engine that shows one shows the other.
const SUBTITLE_NAMES: Readonly<Record<string, readonly string[]>> = {
  vtt: ['vtt', 'webvtt'],
  srt: ['srt', 'subrip'],
  ass: ['ass', 'ssa'],
  pgs: ['pgssub'],
};

const OURS: Readonly<Record<string, string>> = { webvtt: 'vtt', subrip: 'srt', ssa: 'ass', pgssub: 'pgs', h265: 'hevc' };

/**
 * The player's profile as Jellyfin's `DeviceProfile`: the files it plays as
 * they are, a transcode to H.264 and AAC — HLS where the engine has it — for
 * everything else, and subtitles it shows itself, inside the file or the
 * stream. Anything else the server burns in.
 */
export function deviceProfile(profile: PlayerProfile, maxBitrate: number): Readonly<Record<string, unknown>> {
  const hls = profile.protocols.includes('hls');
  const ranges = unique(['SDR', 'DOVIWithSDR', ...(profile.hdr ?? []).flatMap((format) => RANGE_TYPES[format])]);
  const subtitles = profile.subtitleFormats.flatMap((format) => SUBTITLE_NAMES[format] ?? [format]);
  return {
    Name: 'Loge',
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: maxBitrate,
    DirectPlayProfiles: profile.protocols.includes('progressive')
      ? profile.containers.map((container) => ({
          Container: container,
          Type: 'Video',
          VideoCodec: profile.videoCodecs.join(','),
          AudioCodec: profile.audioCodecs.join(','),
        }))
      : [],
    TranscodingProfiles: [
      hls
        ? { Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '6', MinSegments: 1, BreakOnNonKeyFrames: true }
        : { Container: 'mp4', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'http', Context: 'Streaming', MaxAudioChannels: '6' },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      {
        Type: 'Video',
        Conditions: [
          { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: ranges.join('|'), IsRequired: false },
          ...(profile.maxHeight ? [{ Condition: 'LessThanEqual', Property: 'Height', Value: String(profile.maxHeight), IsRequired: false }] : []),
        ],
      },
    ],
    SubtitleProfiles: [
      ...subtitles.map((format) => ({ Format: format, Method: 'Embed' })),
      // A transcode carries text subtitles in its playlist, as WebVTT.
      ...(hls && profile.subtitleFormats.includes('vtt') ? [{ Format: 'vtt', Method: 'Hls' }] : []),
    ],
  };
}

/** Jellyfin's answer as a descriptor, and the session reports will name. */
/** Jellyfin's segment types, as this app names them. Anything else is left out. */
const SEGMENT_KINDS: Readonly<Record<string, MediaSegmentKind>> = {
  Intro: 'intro',
  Outro: 'outro',
  Recap: 'recap',
  Preview: 'preview',
  Commercial: 'commercial',
};

export function toDescriptor(options: {
  readonly info: PlaybackInfoDto;
  readonly request: PlaybackRequest;
  readonly baseUrl: string;
  readonly token: string;
  readonly chapters?: readonly { readonly startTicks: number; readonly name?: string }[];
  readonly segments?: readonly { readonly type: string; readonly startTicks: number; readonly endTicks: number }[];
}): { readonly descriptor: PlaybackDescriptor; readonly session: PlaySession } {
  const { info, request, baseUrl, token } = options;
  const chapters: readonly Chapter[] = (options.chapters ?? [])
    .map((chapter): Chapter => ({ startMs: Math.round(chapter.startTicks / TICKS_PER_MS), ...(chapter.name === undefined ? {} : { title: chapter.name }) }))
    .sort((a, b) => a.startMs - b.startMs);
  const segments: readonly MediaSegment[] = (options.segments ?? [])
    .flatMap((segment): readonly MediaSegment[] => {
      const kind = SEGMENT_KINDS[segment.type];
      return kind
        ? [{ kind, startMs: Math.round(segment.startTicks / TICKS_PER_MS), endMs: Math.round(segment.endTicks / TICKS_PER_MS) }]
        : [];
    })
    .sort((a, b) => a.startMs - b.startMs);
  if (info.errorCode) throw refusal(info.errorCode);
  const source = info.mediaSources[0];
  if (!source) throw new AppError('NOT_FOUND', 'The server has nothing to play for this item.');
  const audio = source.mediaStreams.filter((stream) => stream.type === 'Audio');
  const audioIndex = requestedIndex(request.audioTrackId) ?? source.defaultAudioStreamIndex;
  const subtitleIndex = requestedIndex(request.subtitleTrackId) ?? source.defaultSubtitleStreamIndex;
  const { playSource, playMethod } = streamOf(source, request.profile, baseUrl, request.key.externalId, info.playSessionId, token);
  return {
    descriptor: {
      key: request.key,
      sources: [playSource],
      audioTracks: audio.map((stream) => audioTrack(stream, audioIndex)),
      subtitleTracks: source.mediaStreams.flatMap((stream) => (stream.type === 'Subtitle' ? (subtitleTrack(stream, baseUrl, token) ?? []) : [])),
      ...(request.startMs === undefined ? {} : { startMs: request.startMs }),
      ...(source.runTimeTicks ? { durationMs: Math.round(source.runTimeTicks / TICKS_PER_MS) } : {}),
      // Only where there are any: an empty list says "none here", which is the
      // same to the player as saying nothing, and costs a key to say.
      ...(chapters.length > 0 ? { chapters } : {}),
      ...(segments.length > 0 ? { segments } : {}),
    },
    session: {
      mediaSourceId: source.id,
      ...(info.playSessionId ? { playSessionId: info.playSessionId } : {}),
      playMethod,
      ...(audioIndex === undefined ? {} : { audioStreamIndex: audioIndex }),
      ...(subtitleIndex === undefined ? {} : { subtitleStreamIndex: subtitleIndex }),
    },
  };
}

function streamOf(
  source: MediaSourceDto,
  profile: PlayerProfile,
  baseUrl: string,
  itemId: string,
  playSessionId: string | undefined,
  token: string,
): { playSource: PlaybackSource; playMethod: PlaySession['playMethod'] } {
  if (source.transcodingUrl) {
    const hls = source.transcodingSubProtocol === 'hls';
    return {
      // The server's own address, with its token and play session: used as it is.
      playSource: {
        uri: baseUrl + source.transcodingUrl,
        protocol: hls ? 'hls' : 'progressive',
        ...(!hls && source.transcodingContainer ? { container: source.transcodingContainer } : {}),
        videoCodec: 'h264',
        audioCodecs: ['aac'],
        transcoded: true,
        live: false,
      },
      playMethod: 'Transcode',
    };
  }
  if (!source.supportsDirectPlay && !source.supportsDirectStream) {
    throw new AppError('INVALID_STATE', 'The server has no way to play this for this player.');
  }
  const video = source.mediaStreams.find((stream) => stream.type === 'Video');
  const audioCodecs = unique(
    source.mediaStreams.flatMap((stream) => (stream.type === 'Audio' && stream.codec ? [ours(stream.codec)] : [])),
  );
  const container = containerFor(source.container, profile);
  const hdr = hdrOf(video?.videoRangeType);
  return {
    playSource: {
      uri:
        `${baseUrl}/Videos/${encodeURIComponent(itemId)}/stream${container ? `.${container}` : ''}` +
        queryString({ static: true, mediaSourceId: source.id, playSessionId, Tag: source.eTag, api_key: token }),
      protocol: 'progressive',
      ...(container ? { container } : {}),
      ...(video?.codec ? { videoCodec: ours(video.codec) } : {}),
      ...(audioCodecs.length > 0 ? { audioCodecs } : {}),
      ...(hdr ? { hdr } : {}),
      ...(video?.height ? { height: video.height } : {}),
      transcoded: false,
      live: false,
    },
    playMethod: source.supportsDirectPlay ? 'DirectPlay' : 'DirectStream',
  };
}

/**
 * ffprobe names a file several ways — `mov,mp4,m4a,3gp,3g2,mj2` — and
 * Jellyfin passes one or all of them on. The descriptor names it as the
 * player does, so `canPlay` agrees with the server that matched it.
 */
export function containerFor(reported: string | undefined, profile: PlayerProfile): string | undefined {
  if (!reported) return undefined;
  const names = reported.toLowerCase().split(',').map((name) => name.trim()).filter(Boolean);
  const isoFamily = names.some((name) => ['mov', 'mp4', 'm4v', 'm4a', '3gp', '3g2', 'mj2'].includes(name));
  const candidates = isoFamily ? unique([...names, 'mp4', 'm4v', 'mov']) : names;
  return candidates.find((name) => profile.containers.includes(name)) ?? names[0];
}

function audioTrack(stream: MediaStreamDto, chosen: number | undefined): AudioTrack {
  const language = bcp47(stream.language);
  return {
    id: String(stream.index),
    label: stream.displayTitle ?? stream.title ?? language ?? `Audio ${stream.index}`,
    ...(language ? { language } : {}),
    ...(stream.codec ? { codec: ours(stream.codec) } : {}),
    ...(stream.channels ? { channels: stream.channels } : {}),
    ...(stream.index === chosen ? { default: true } : {}),
  };
}

function subtitleTrack(stream: MediaStreamDto, baseUrl: string, token: string): SubtitleTrack | undefined {
  const delivery = deliveryOf(stream.deliveryMethod);
  if (!delivery) return undefined;
  const language = bcp47(stream.language);
  const uri = delivery === 'external' && stream.deliveryUrl ? withToken(absolute(baseUrl, stream.deliveryUrl), token) : undefined;
  return {
    id: String(stream.index),
    label: stream.displayTitle ?? stream.title ?? language ?? `Subtitles ${stream.index}`,
    ...(language ? { language } : {}),
    format: stream.codec ? ours(stream.codec) : 'unknown',
    delivery,
    ...(uri ? { uri } : {}),
    ...(stream.isForced ? { forced: true } : {}),
    ...(stream.isDefault ? { default: true } : {}),
  };
}

export function deliveryOf(method: string | undefined): SubtitleDelivery | undefined {
  switch (method) {
    case 'External':
      return 'external';
    case 'Encode':
      return 'burned';
    case 'Drop':
      return undefined;
    // `Embed` and `Hls`: inside the file or the stream, where the engine finds it.
    default:
      return 'embedded';
  }
}

export function hdrOf(rangeType: string | undefined): HdrFormat | undefined {
  if (!rangeType) return undefined;
  if (rangeType.startsWith('DOVI') && rangeType !== 'DOVIWithSDR') return 'dolby-vision';
  if (rangeType === 'HDR10Plus') return 'hdr10+';
  if (rangeType === 'HDR10') return 'hdr10';
  if (rangeType === 'HLG') return 'hlg';
  return undefined;
}

function refusal(code: string): AppError {
  if (code === 'RateLimitExceeded') return new AppError('PROVIDER_UNAVAILABLE', 'The server is busy streaming to others.', { retry: 'backoff' });
  if (code === 'NotAllowed') return new AppError('INVALID_STATE', 'This server user may not play this.');
  return new AppError('INVALID_STATE', 'The server has no stream this player can play.');
}

function requestedIndex(id: string | undefined): number | undefined {
  if (id === undefined) return undefined;
  const index = Number(id);
  return Number.isInteger(index) ? index : undefined;
}

export function ours(codec: string): string {
  const name = codec.toLowerCase();
  return OURS[name] ?? name;
}

function absolute(baseUrl: string, url: string): string {
  return /^[a-z]+:\/\//i.test(url) ? url : baseUrl + (url.startsWith('/') ? url : `/${url}`);
}

function withToken(url: string, token: string): string {
  return /[?&](api_key|ApiKey)=/.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(token)}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
