/**
 * Yattee Server — media only: YouTube and other web video, from a server the
 * household runs itself.
 *
 * It is not Invidious, though it answers in Invidious' vocabulary: a FastAPI
 * service over yt-dlp, with HTTP Basic Auth on everything once it is set up.
 * `sources/invidious` is a different sign-in against the same shapes.
 */
import { pluginId, type Plugin } from '@loge/api';

import { createProvider } from './provider';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/yattee'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Yattee Server',
    description: 'Backend for YouTube and other web video.',
    credits: [{ name: 'Yattee Server', url: 'https://github.com/yattee/yattee-server', note: 'The server it connects to.' }],
    media: {
      contentKinds: ['videos'],
      capabilities: ['browse', 'search', 'feed', 'playback', 'remoteImages', 'offlineMetadata', 'downloads', 'downloadOptions'],
      // The server's search takes a `type`: everything, or only videos, channels or playlists.
      searchScopes: ['all', 'video', 'channel', 'playlist'],
    },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://yattee.example.com',
      },
      {
        key: 'username',
        label: 'Username',
        type: 'text',
        required: true,
        // Half of the Basic sign-in, so it stays with the password when a
        // connection keeps credentials per profile.
        credential: true,
      },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    settings: [
      {
        key: 'proxyMode',
        label: 'Stream through the server',
        description:
          'Relay keeps the site from seeing this device, and supports seeking. Off sends the player straight to the site, which is faster where it is reachable.',
        type: 'select',
        options: [
          { value: 'relay', label: 'Relay' },
          { value: 'off', label: 'Off' },
        ],
        default: 'relay',
      },
      {
        key: 'region',
        label: 'Trending from',
        description: 'Which country’s trending list to show when nothing is searched for.',
        type: 'text',
        default: 'US',
        placeholder: 'US',
      },
      {
        key: 'cacheMetadata',
        label: 'Keep metadata on this device',
        description: 'Show videos you have opened before while the server is unreachable.',
        type: 'boolean',
        default: true,
        gates: ['media.offlineMetadata'],
      },
    ],
  },
  media: {
    connect: async (target, context) => createProvider(target, context),
  },
};
