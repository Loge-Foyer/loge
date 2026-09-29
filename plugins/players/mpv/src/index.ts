import { pluginId, type Plugin } from '@sc/api';

/** Manifest only: no engine yet, so it states no profile and the app never picks it. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('players/mpv'),
    category: 'players',
    platforms: ['ios', 'android'],
    displayName: 'mpv',
    description: 'The mpv engine: plays nearly any file — MKV, HEVC, DTS, TrueHD — with libass subtitles.',
    player: { profiles: {} },
    connectionFields: [],
    settings: [],
  },
};
