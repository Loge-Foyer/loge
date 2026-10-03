/**
 * The built-in player: expo-video — AVPlayer on iPhone and iPad, Media3 on
 * Android — and on the web the browser's own `<video>`, with hls.js fetched
 * when the browser has no HLS of its own. Its profiles say what each plays.
 */
import { pluginId } from '@loge/api';
import type { PlayerPlugin } from '@loge/player-kit';

import { createEngine } from './engine';
import { PROFILES } from './profiles';
import { SystemPlayerView } from './view';

export const plugin: PlayerPlugin = {
  manifest: {
    id: pluginId('players/system'),
    category: 'players',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Built-in player',
    description: 'The device’s own player: AVPlayer on iPhone and iPad, Media3 on Android, the browser’s on the web.',
    credits: [
      { name: 'expo-video', url: 'https://github.com/expo/expo', note: 'The player on iPhone and Android.', platforms: ['ios', 'android'] },
      { name: 'Media3', url: 'https://github.com/androidx/media', note: 'Android’s own player, under expo-video.', platforms: ['android'] },
      { name: 'hls.js', url: 'https://github.com/video-dev/hls.js', note: 'HLS in a browser.', platforms: ['web'] },
      { name: 'mpegts.js', url: 'https://github.com/xqq/mpegts.js', note: 'Raw MPEG-TS in a browser.', platforms: ['web'] },
    ],
    player: { profiles: PROFILES },
    connectionFields: [],
    settings: [],
  },
  player: {
    create: (context) => createEngine(context),
  },
  View: SystemPlayerView,
};
