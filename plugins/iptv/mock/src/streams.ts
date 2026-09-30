import type { PlaybackSource } from '@sc/api';

/**
 * What the mock plays: public test streams, since it has no server of its
 * own. Browsing works offline; playing needs the network. Each was probed —
 * H.264 and AAC throughout — and the HLS ones send CORS headers, which hls.js
 * needs in a browser.
 */
const LIVE_HLS = 'https://demo.unified-streaming.com/k8s/live/stable/scte35.isml/.m3u8';
const LOOPED_HLS: Choices = [
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
];
// Ten seconds of raw MPEG-TS over HTTP: what AVPlayer and a browser cannot play, and ExoPlayer can.
const TRANSPORT_STREAM = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear1/fileSequence0.ts';
const FILES: Choices = [
  'https://media.w3.org/2010/05/sintel/trailer.mp4',
  'https://media.w3.org/2010/05/bunny/trailer.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
];

const CODECS = { videoCodec: 'h264', audioCodecs: ['aac'] } as const;

type Choices = readonly [string, ...string[]];
const pick = (choices: Choices, index: number) => choices[index % choices.length] ?? choices[0];

/** A channel's stream: most loop a test stream as if it were live; the first of every four is really live. */
export function channelSource(number: number, transportStreamOnly: boolean): PlaybackSource {
  if (transportStreamOnly) return { uri: TRANSPORT_STREAM, protocol: 'mpegts', container: 'ts', ...CODECS, transcoded: false, live: true };
  // Not `% 4 === 0`: that is the last of each group in the small lineup, which only plays MPEG-TS.
  const uri = number % 4 === 1 ? LIVE_HLS : pick(LOOPED_HLS, number);
  return { uri, protocol: 'hls', ...CODECS, transcoded: false, live: true };
}

export function movieSource(index: number): PlaybackSource {
  return { uri: pick(FILES, index), protocol: 'progressive', container: 'mp4', ...CODECS, transcoded: false, live: false };
}

export function episodeSource(index: number): PlaybackSource {
  return { uri: pick(LOOPED_HLS, index), protocol: 'hls', ...CODECS, transcoded: false, live: false };
}
