import { pluginId, type Plugin } from '@sc/api';

/** Manifest only: no engine yet, so it states no profile and the app never picks it. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('players/vlc'),
    category: 'players',
    platforms: ['ios', 'android'],
    displayName: 'VLC',
    description: 'VLC’s engine: plays nearly anything, streams included.',
    player: { profiles: {} },
    connectionFields: [],
    settings: [],
  },
};
