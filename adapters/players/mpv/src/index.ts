/**
 * The mpv engine, for nearly any file — Matroska, HEVC, DTS, TrueHD — with
 * libass subtitles and any header a stream needs. Through the Expo module in
 * this package: `android/` on Android, `ios/` on iPhone, libmpv's own C API
 * behind both.
 */
import { pluginId } from '@loge/api';
import type { PlayerPlugin } from '@loge/player-kit';

import { createEngine } from './engine';
import { PROFILES } from './profiles';
import { MpvPlayerView } from './view';

export const plugin: PlayerPlugin = {
  manifest: {
    id: pluginId('players/mpv'),
    category: 'players',
    platforms: ['ios', 'android'],
    displayName: 'mpv',
    description: 'The mpv engine: plays nearly any file, with subtitles drawn as the file styles them.',
    credits: [
      { name: 'mpv', url: 'https://github.com/mpv-player/mpv', note: 'The engine.' },
      { name: 'libmpv-android', url: 'https://github.com/jarnedemeulemeester/libmpv-android', note: 'mpv, built for Android.', platforms: ['android'] },
      { name: 'MPVKit', url: 'https://github.com/mpvkit/MPVKit', note: 'mpv for iPhone and Apple TV, built from Streamyfin’s fork.', platforms: ['ios'] },
    ],
    player: { profiles: PROFILES },
    connectionFields: [],
    settings: [],
  },
  player: {
    create: (context) => createEngine(context),
  },
  View: MpvPlayerView,
};
