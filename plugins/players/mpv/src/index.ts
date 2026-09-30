/**
 * The mpv engine, for nearly any file — Matroska, HEVC, DTS, TrueHD — with
 * libass subtitles and any header a stream needs. Through the Expo module in
 * this package: `android/` on Android, `ios/` on iPhone, libmpv's own C API
 * behind both.
 */
import { pluginId } from '@sc/api';
import type { PlayerPlugin } from '@sc/player-kit';

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
    player: { profiles: PROFILES },
    connectionFields: [],
    settings: [],
  },
  player: {
    create: (context) => createEngine(context),
  },
  View: MpvPlayerView,
};
