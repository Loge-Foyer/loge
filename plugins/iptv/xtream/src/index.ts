import { pluginId, type Plugin } from '@sc/api';

/**
 * Manifest only: no media role yet, so no capability is declared. IPTV runs on
 * phones: providers rarely send CORS headers, so a browser cannot reach them.
 */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('iptv/xtream'),
    category: 'iptv',
    platforms: ['ios', 'android'],
    displayName: 'Xtream Codes',
    description: 'Live TV, films and series from an Xtream Codes provider.',
    media: { contentKinds: ['live', 'movies', 'shows'], capabilities: [] },
    connectionFields: [
      { key: 'serverUrl', label: 'Server address', type: 'url', required: true, placeholder: 'http://provider.example.com:8080' },
      { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    settings: [],
  },
};
