/**
 * The mpv engine, for nearly any file — Matroska, HEVC, DTS, TrueHD — with
 * libass subtitles and any header a stream needs. Android for now, through the
 * Expo module in `android/`; MPVKit on iPhone and iPad comes later.
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
    platforms: ['android'],
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
