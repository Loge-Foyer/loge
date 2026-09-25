/**
 * Mock — media and sync, with no network at all, so every screen can be built
 * and exercised offline.
 *
 * It declares a deliberately partial set of capabilities, and a toggle for
 * each gateable one: a mock that can do everything lets broken capability
 * handling go unnoticed. Its fields cover every field type the app renders.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('mock'),
    displayName: 'Mock',
    description: 'A pretend server with a fixed catalogue, for working offline.',
    media: {
      contentKinds: ['movies', 'shows', 'anime', 'videos', 'files'],
      capabilities: ['home', 'libraries', 'watchStateRead', 'watchStateWrite', 'remoteImages'],
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
      {
        key: 'reportWatchState',
        label: 'Report playback progress to the mock',
        type: 'boolean',
        default: true,
        gates: ['media.watchStateWrite'],
      },
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
};
