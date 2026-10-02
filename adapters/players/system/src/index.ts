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
    player: { profiles: PROFILES },
    connectionFields: [],
    settings: [],
  },
  player: {
    create: (context) => createEngine(context),
  },
  View: SystemPlayerView,
};
