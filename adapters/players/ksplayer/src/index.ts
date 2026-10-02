import { pluginId, type Plugin } from '@loge/api';

/** Manifest only: no engine yet, so it states no profile and the app never picks it. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('players/ksplayer'),
    category: 'players',
    platforms: ['ios'],
    displayName: 'KSPlayer',
    description: 'An FFmpeg-based player for iPhone and iPad: MKV, HEVC, HDR and Dolby Vision, ASS and PGS subtitles.',
    player: { profiles: {} },
    connectionFields: [],
    settings: [],
  },
};
