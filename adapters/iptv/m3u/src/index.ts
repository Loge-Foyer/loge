import { pluginId, type Plugin } from '@loge/api';

/**
 * Manifest only: no media role yet, so no capability is declared. IPTV runs on
 * phones: providers rarely send CORS headers, so a browser cannot reach them.
 */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('iptv/m3u'),
    category: 'iptv',
    platforms: ['ios', 'android'],
    displayName: 'M3U playlist',
    description: 'Live TV from an M3U playlist, with its XMLTV guide.',
    media: { contentKinds: ['live'], capabilities: [] },
    connectionFields: [
      {
        key: 'playlist',
        label: 'Playlist address',
        type: 'password',
        required: true,
        description: 'Kept like a password: providers put your sign-in in it.',
      },
      { key: 'guideUrl', label: 'Guide address', type: 'url', description: 'An XMLTV guide, if the playlist does not name one.' },
    ],
    settings: [],
  },
};
