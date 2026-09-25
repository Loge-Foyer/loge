/**
 * Custom server — sync only, to a server you run yourself
 * (streaming_center_sync).
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so the list is empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('custom-server'),
    displayName: 'Sync server',
    description: 'Your own Streaming Center sync server.',
    sync: { capabilities: [] },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://sync.example.com',
      },
      { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    ],
    settings: [],
  },
};
