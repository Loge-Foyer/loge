/**
 * Yattee Server payloads as recorded, in the server's own shape — which is
 * Invidious-compatible. Nothing here is a domain type: `map.ts` makes those.
 */

export const health = { status: 'ok' };

export const info = {
  version: '1.4.2',
  dependencies: { 'yt-dlp': '2026.07.04' },
};

export const video = {
  type: 'video',
  videoId: 'dQw4w9WgXcQ',
  title: 'A video with a long enough name to wrap',
  description: 'What the uploader wrote underneath.',
  author: 'Some Channel',
  authorId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
  lengthSeconds: 213,
  published: 1_288_312_200,
  publishedText: '15 years ago',
  viewCount: 1_600_000_000,
  liveNow: false,
  extractionMethod: 'hybrid',
  videoThumbnails: [
    { quality: 'maxres', url: 'https://i.example/maxres.jpg', width: 1280, height: 720 },
    { quality: 'medium', url: 'https://i.example/medium.jpg', width: 320, height: 180 },
  ],
  formatStreams: [
    {
      itag: '18',
      url: 'https://yt.test/proxy/relay?url=abc&sig=deadbeef&exp=99',
      type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      container: 'mp4',
      quality: 'medium',
      qualityLabel: '360p',
      resolution: '360p',
      bitrate: 696_000,
      clen: '18874368',
      fps: 30,
    },
    {
      itag: '22',
      url: 'https://yt.test/proxy/relay?url=def&sig=cafebabe&exp=99',
      type: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
      container: 'mp4',
      quality: 'hd720',
      qualityLabel: '720p',
      resolution: '720p',
      bitrate: 2_400_000,
      clen: '64225280',
      fps: 30,
    },
  ],
  adaptiveFormats: [
    {
      itag: '137',
      url: 'https://yt.test/proxy/relay?url=ghi&sig=1234&exp=99',
      type: 'video/mp4; codecs="avc1.640028"',
      container: 'mp4',
      qualityLabel: '1080p',
      bitrate: 4_200_000,
      clen: '112328704',
      fps: 30,
    },
    {
      itag: '140',
      url: 'https://yt.test/proxy/relay?url=jkl&sig=5678&exp=99',
      type: 'audio/mp4; codecs="mp4a.40.2"',
      container: 'm4a',
      audioQuality: 'AUDIO_QUALITY_MEDIUM',
      bitrate: 128_000,
      clen: '3407872',
    },
  ],
  captions: [
    { label: 'English', language_code: 'en', url: '/api/v1/captions/dQw4w9WgXcQ/content?lang=en&token=abc' },
    { label: 'Deutsch', language_code: 'de', url: '/api/v1/captions/dQw4w9WgXcQ/content?lang=de&token=abc' },
  ],
};

export const liveVideo = {
  ...video,
  videoId: 'live1234567',
  title: 'A channel that is on air',
  liveNow: true,
  lengthSeconds: 0,
  formatStreams: [
    {
      itag: '91',
      url: 'https://yt.test/proxy/relay?url=live&sig=99&exp=99',
      type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      container: 'mp4',
      qualityLabel: '720p',
    },
  ],
};

export const trending = [
  video,
  { ...video, videoId: 'second00000', title: 'The second one', published: 1_588_312_200 },
];

export const searchResults = [
  { ...video, videoId: 'found000001', title: 'A found video' },
  { ...video, videoId: 'found000002', title: 'Another found video' },
];

export const channel = {
  author: 'Some Channel',
  authorId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
  description: 'What the channel says about itself.',
  subCount: 1_234_567,
  authorThumbnails: [
    { url: 'https://i.example/avatar512.jpg', width: 512, height: 512 },
    { url: 'https://i.example/avatar100.jpg', width: 100, height: 100 },
  ],
  authorBanners: [
    { url: 'https://i.example/banner1060.jpg', width: 1060, height: 175 },
    { url: 'https://i.example/banner2120.jpg', width: 2120, height: 351 },
  ],
};

export const channelVideos = {
  videos: [
    { ...video, videoId: 'chanvid0001', title: 'The channel’s newest' },
    { ...video, videoId: 'chanvid0002', title: 'The one before it' },
  ],
};

export const playlist = {
  playlistId: 'PLabcdefghij',
  title: 'Things worth rewatching',
  description: 'A list someone made.',
  author: 'Some Channel',
  videoCount: 2,
  videos: [
    { ...video, videoId: 'plvid000001', title: 'First in the list' },
    { ...video, videoId: 'plvid000002', title: 'Second in the list' },
  ],
};

/** `type=all`: a video, a channel and a playlist, each as the server lists them. */
export const mixedResults = [
  { ...video, videoId: 'found000001', title: 'A found video' },
  { type: 'channel', author: 'Some Channel', authorId: 'UCuAXFkgsw1L7xaCfnd5JJOw', subCount: 1_234_567, videoCount: 321, authorThumbnails: channel.authorThumbnails },
  {
    type: 'playlist',
    playlistId: 'PLabcdefghij',
    title: 'Things worth rewatching',
    author: 'Some Channel',
    authorId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    videoCount: 2,
    playlistThumbnail: 'https://i.example/playlist.jpg',
    videos: [],
  },
];

export const channelPlaylists = {
  playlists: [
    {
      type: 'playlist',
      playlistId: 'PLabcdefghij',
      title: 'Things worth rewatching',
      author: 'Some Channel',
      authorId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      videoCount: 2,
      playlistThumbnail: 'https://i.example/playlist.jpg',
      videos: [],
    },
  ],
};
