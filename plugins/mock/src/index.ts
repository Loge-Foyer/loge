/**
 * Mock — media and sync, with no network at all, so every screen can be built
 * and exercised offline.
 *
 * It declares a deliberately partial set of capabilities: a mock that can do
 * everything lets broken capability handling go unnoticed. It has no artwork,
 * so the app's placeholders get used, and it cannot be kept offline. Its fields
 * cover every field type the app renders. The sync role is still a manifest.
 */
import { pluginId, type Plugin } from '@sc/api';

import { createProvider } from './provider';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('mock'),
    displayName: 'Mock',
    description: 'A pretend server with a fixed catalogue, for working offline.',
    media: {
      contentKinds: ['movies', 'shows', 'anime', 'videos', 'files'],
      capabilities: ['browse', 'libraries', 'watchStateRead'],
    },
    sync: { capabilities: ['watchProgress', 'favorites', 'watchlist'] },
    connectionFields: [
      { key: 'libraryName', label: 'Library name', type: 'text', default: 'Mock library' },
      {
        key: 'endpoint',
        label: 'Endpoint',
        type: 'url',
        placeholder: 'mock://catalogue',
        description: 'Ignored. The catalogue never leaves the device.',
      },
      { key: 'username', label: 'Username', type: 'text', credential: true, description: 'Optional, and ignored.' },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        description: 'Optional. Any value works; it exercises the credential store.',
      },
      {
        key: 'catalogueSize',
        label: 'Catalogue size',
        type: 'select',
        default: 'small',
        options: [
          { value: 'small', label: 'Small' },
          { value: 'large', label: 'Large' },
        ],
      },
    ],
    settings: [
      {
        key: 'latency',
        label: 'Simulated latency',
        type: 'select',
        default: 'none',
        options: [
          { value: 'none', label: 'None' },
          { value: 'slow', label: 'Slow' },
          { value: 'flaky', label: 'Flaky' },
        ],
      },
      { key: 'libraries', label: 'Libraries to show', type: 'libraries', default: { mode: 'all' } },
      {
        key: 'syncWatchProgress',
        label: 'Sync watch progress',
        type: 'boolean',
        default: false,
        gates: ['sync.watchProgress'],
      },
      {
        key: 'syncFavorites',
        label: 'Sync favourites',
        type: 'boolean',
        default: false,
        gates: ['sync.favorites'],
      },
      {
        key: 'syncWatchlist',
        label: 'Sync watchlist',
        type: 'boolean',
        default: false,
        gates: ['sync.watchlist'],
      },
    ],
  },
  media: {
    connect: async (target, context) => createProvider(target, context),
  },
};
