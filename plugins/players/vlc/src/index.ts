/**
 * VLC's engine, libVLC, for nearly anything — Matroska, DTS and TrueHD, raw
 * MPEG-TS, the subtitles inside a file. Android for now, through the Expo
 * module in `android/`; VLCKit on iPhone and iPad comes later.
 */
import { pluginId } from '@sc/api';
import type { PlayerPlugin } from '@sc/player-kit';

import { createEngine } from './engine';
import { PROFILES } from './profiles';
import { VlcPlayerView } from './view';

export const plugin: PlayerPlugin = {
  manifest: {
    id: pluginId('players/vlc'),
    category: 'players',
    platforms: ['android'],
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
