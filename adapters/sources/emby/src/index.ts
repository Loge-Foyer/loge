/**
 * Emby — a media source for films and series. Like Jellyfin, the server stays
 * the master of what each user watched, so there is no sync role.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so the list is empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@loge/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/emby'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Emby',
    description: 'Media server for films and TV, a close relative of Jellyfin.',
    media: { contentKinds: ['movies', 'shows'], capabilities: [] },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://emby.example.com',
      },
      { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    settings: [],
  },
};
