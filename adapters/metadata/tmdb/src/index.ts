/**
 * TMDB — metadata only: what a film or a series is, by its name, for a source
 * that does not say. It reads the public catalogue with the household's own
 * key, and never writes anything to TMDB.
 */
import { pluginId, type Plugin } from '@sc/api';

import { createProvider } from './provider';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('metadata/tmdb'),
    category: 'metadata',
    // TMDB answers browsers too: its API sends CORS headers.
    platforms: ['ios', 'android', 'web'],
    displayName: 'TMDB',
    description: 'Finds which film or series a title is, so its watch status covers every copy of it.',
    // TMDB's terms ask for this wherever an app lists what it uses.
    attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    metadata: { identifies: ['movies', 'shows'] },
    connectionFields: [
      {
        key: 'apiKey',
        label: 'API key or Read Access Token',
        type: 'password',
        required: true,
        description: 'Your own, from themoviedb.org → Settings → API. Either one works.',
      },
    ],
    settings: [],
  },
  metadata: { connect: async (target, context) => createProvider(target, context) },
};
