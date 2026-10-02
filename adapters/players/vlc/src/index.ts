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
    player: { profiles: PROFILES },
    connectionFields: [],
    settings: [],
  },
  player: {
    create: (context) => createEngine(context),
  },
  View: VlcPlayerView,
};
