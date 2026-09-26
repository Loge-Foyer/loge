/**
 * Plex — a media source for films and series. Plex's own account model stays
 * inside this plugin; the app only ever sees a server URL and a token. The
 * server stays the master of watch state, so there is no sync role.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so the list is empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('plex'),
    displayName: 'Plex',
    description: 'Plex Media Server, for films and TV.',
    media: { contentKinds: ['movies', 'shows'], capabilities: [] },
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
