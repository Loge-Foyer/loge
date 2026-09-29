/**
 * Jellyfin — a media source for films and series. It reads what each server
 * user has watched; the server stays the master of that, so the plugin has no
 * sync role.
 */
import { pluginId, type Plugin } from '@sc/api';

import { createProvider } from './provider';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/jellyfin'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Jellyfin',
    description: 'Self-hosted film and TV server.',
    media: {
      contentKinds: ['movies', 'shows'],
      capabilities: ['browse', 'libraries', 'watchStateRead', 'remoteImages', 'offlineMetadata'],
    },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server address',
        type: 'url',
        required: true,
        placeholder: 'http://192.168.1.20:8096',
        description: 'scheme://host:port — add the base path if your server has one.',
      },
      {
        key: 'localOnly',
        label: 'Local network only',
        type: 'boolean',
        default: true,
        description: 'Skipped on mobile data, and not tried again and again when it cannot be reached.',
      },
      { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    settings: [
      {
        key: 'cacheMetadata',
        label: 'Keep metadata on this device',
        type: 'boolean',
        default: true,
        description: 'Artwork, descriptions and cast, so browsing is quick and works offline.',
        gates: ['media.offlineMetadata'],
      },
      {
        key: 'libraries',
        label: 'Libraries to show',
        type: 'libraries',
        default: { mode: 'all' },
      },
    ],
  },
  media: {
    connect: async (target, context) => createProvider(target, context),
  },
};
