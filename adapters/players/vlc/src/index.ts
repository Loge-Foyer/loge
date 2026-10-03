/**
 * VLC's engine, libVLC, for nearly anything — Matroska, DTS and TrueHD, raw
 * MPEG-TS, the subtitles inside a file. Through the Expo module in this
 * package: `android/` on Android, `ios/` on iPhone, one engine behind both.
 */
import { pluginId } from '@loge/api';
import type { PlayerPlugin } from '@loge/player-kit';

import { createEngine } from './engine';
import { PROFILES } from './profiles';
import { VlcPlayerView } from './view';

export const plugin: PlayerPlugin = {
  manifest: {
    id: pluginId('players/vlc'),
    category: 'players',
    platforms: ['ios', 'android'],
    displayName: 'VLC',
    description: 'VLC’s engine: plays nearly anything, streams included.',
    credits: [
      { name: 'VLC', url: 'https://github.com/videolan/vlc', note: 'The engine: libVLC.' },
      { name: 'VLC for Android', url: 'https://github.com/videolan/vlc-android', note: 'libVLC, built for Android.', platforms: ['android'] },
      { name: 'VLCKit', url: 'https://github.com/videolan/vlckit', note: 'libVLC for iPhone and Apple TV.', platforms: ['ios'] },
    ],
    player: { profiles: PROFILES },
    connectionFields: [],
    settings: [],
  },
  player: {
    create: (context) => createEngine(context),
  },
  View: VlcPlayerView,
};
