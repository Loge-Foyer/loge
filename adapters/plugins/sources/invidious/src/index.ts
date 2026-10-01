/**
 * Invidious — media only. Instance-based, so a connection is an instance URL
 * rather than an account.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so the list is empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/invidious'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Invidious',
    description: 'A privacy-respecting YouTube front end.',
    media: { contentKinds: ['videos'], capabilities: [] },
    connectionFields: [
      {
        key: 'instanceUrl',
        label: 'Instance URL',
        type: 'url',
        required: true,
        placeholder: 'https://invidious.example.com',
      },
    ],
    settings: [],
  },
};
