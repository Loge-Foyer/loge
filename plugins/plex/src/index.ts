/**
 * Plex — media and sync, one manifest. Plex's own account model stays inside
 * this plugin; the app only ever sees a server URL and a token.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so both lists are empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('plex'),
    displayName: 'Plex',
    description: 'Plex Media Server, for films and TV.',
    media: { contentKinds: ['movies', 'shows'], capabilities: [] },
    sync: { capabilities: [] },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://plex.example.com:32400',
      },
      { key: 'token', label: 'Plex token', type: 'password', required: true },
    ],
    settings: [],
  },
};
