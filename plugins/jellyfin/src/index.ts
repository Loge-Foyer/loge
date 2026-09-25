/**
 * Jellyfin — media and sync, one manifest.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so both lists are empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('jellyfin'),
    displayName: 'Jellyfin',
    description: 'Self-hosted film and TV server.',
    media: { contentKinds: ['movies', 'shows'], capabilities: [] },
    sync: { capabilities: [] },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://jellyfin.example.com',
      },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    settings: [],
  },
};
