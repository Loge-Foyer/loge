import { pluginId, type Plugin } from '@sc/api';

/** Manifest only: no engine yet, so it states no profile and the app never picks it. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('players/system'),
    category: 'players',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Built-in player',
    description: 'The device’s own player: AVPlayer on iPhone and iPad, Media3 on Android, the browser’s on the web.',
    player: { profiles: {} },
    connectionFields: [],
    settings: [],
  },
};
