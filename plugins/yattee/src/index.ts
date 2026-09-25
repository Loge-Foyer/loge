/**
 * Yattee Server — media only: YouTube and other web video.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so the list is empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('yattee'),
    displayName: 'Yattee Server',
    description: 'Backend for YouTube and other web video.',
    media: { contentKinds: ['videos'], capabilities: [] },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://yattee.example.com',
      },
    ],
    settings: [],
  },
};
