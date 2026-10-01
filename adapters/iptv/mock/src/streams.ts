import type { PlaybackSource } from '@sc/api';

/**
 * What the mock plays: public test streams, since it has no server of its
 * own. Browsing works offline; playing needs the network. Each was probed —
 * H.264 throughout, AAC where there is sound — and played in Chrome and on
 * Android; the HLS ones send CORS headers, which hls.js needs in a browser.
 */
const LIVE_HLS = 'https://demo.unified-streaming.com/k8s/live/stable/scte35.isml/.m3u8';
const LOOPED_HLS: Choices = [
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
];
// Ten seconds of raw MPEG-TS over HTTP, with CORS headers: what AVPlayer cannot
// play, and Media3, mpv and a browser with mpegts.js can. Not Apple's bipbop
// segments: remuxed by mpegts.js, Chrome's VideoToolbox decoder on a Mac
// refuses their H.264.
const TRANSPORT_STREAM = 'https://test-streams.mux.dev/x36xhzz/url_0/url_462/193039199_mp4_h264_aac_hd_7.ts';
// Short files a browser opens as well as a phone. W3C's trailers are not among them: Chrome calls them a "format error".
const FILES: readonly [FileStream, ...FileStream[]] = [
  { uri: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', sound: true },
  { uri: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4', sound: false },
  { uri: 'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4', sound: false },
];

interface FileStream {
  readonly uri: string;
  readonly sound: boolean;
}

const CODECS = { videoCodec: 'h264', audioCodecs: ['aac'] } as const;

type Choices = readonly [string, ...string[]];
const pick = <T>(choices: readonly [T, ...T[]], index: number): T => choices[index % choices.length] ?? choices[0];

/** A channel's stream: most loop a test stream as if it were live; the first of every four is really live. */
export function channelSource(number: number, transportStreamOnly: boolean): PlaybackSource {
  if (transportStreamOnly) return { uri: TRANSPORT_STREAM, protocol: 'mpegts', container: 'ts', ...CODECS, transcoded: false, live: true };
  // Not `% 4 === 0`: that is the last of each group in the small lineup, which only plays MPEG-TS.
  const uri = number % 4 === 1 ? LIVE_HLS : pick(LOOPED_HLS, number);
  return { uri, protocol: 'hls', ...CODECS, transcoded: false, live: true };
}

export function movieSource(index: number): PlaybackSource {
  const file = pick(FILES, index);
  return {
    uri: file.uri,
    protocol: 'progressive',
    container: 'mp4',
    videoCodec: 'h264',
    ...(file.sound ? { audioCodecs: ['aac'] } : {}),
    transcoded: false,
    live: false,
  };
}

export function episodeSource(index: number): PlaybackSource {
  return { uri: pick(LOOPED_HLS, index), protocol: 'hls', ...CODECS, transcoded: false, live: false };
}
