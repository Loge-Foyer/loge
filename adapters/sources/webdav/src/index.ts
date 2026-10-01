/**
 * WebDAV — media only. Plain files: no server supplies titles or artwork.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so the list is empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/webdav'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: 'WebDAV',
    description: 'Plain video files on a NAS or any WebDAV share.',
    media: { contentKinds: ['files'], capabilities: [] },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://nas.local/webdav',
      },
      { key: 'username', label: 'Username', type: 'text', credential: true },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    settings: [],
  },
};
