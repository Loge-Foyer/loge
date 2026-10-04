/**
 * Mock IPTV — a pretend portal: channels in groups, a guide, and a few films
 * and series, the same on every run, so the Live tab can be built and tested
 * offline. Playing reaches public test streams, so it needs the network.
 *
 * Like the other mocks it declines some capabilities on purpose: no artwork,
 * no watch state, no libraries. Its guide can be switched off per connection,
 * which is what exercises a toggle's effect on the Live tab. It runs in a
 * browser too, having no portal to be refused by.
 */
import { pluginId, type Plugin } from '@loge/api';

import { createProvider } from './provider';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('iptv/mock'),
    category: 'iptv',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Mock portal',
    description: 'A pretend IPTV portal with fixed channels, a guide and a few films and series, for working offline.',
    media: {
      contentKinds: ['live', 'movies', 'shows'],
      capabilities: ['browse', 'search', 'channels', 'epg', 'playback'],
    },
    connectionFields: [
      { key: 'portalUrl', label: 'Portal address', type: 'url', placeholder: 'mock://portal', description: 'Optional, and ignored.' },
      {
        key: 'mac',
        label: 'MAC address',
        type: 'password',
        placeholder: '00:1A:79:00:00:00',
        description: 'Optional. Any value works; it is kept like a real portal’s.',
      },
      {
        key: 'lineupSize',
        label: 'Channels',
        type: 'select',
        default: 'small',
        options: [
          { value: 'small', label: 'A few (20)' },
          { value: 'large', label: 'Many (200)' },
        ],
      },
    ],
    settings: [
      { key: 'guide', label: 'Programme guide', type: 'boolean', default: true, gates: ['media.epg'] },
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
    ],
  },
  media: {
    connect: async (target, context) => createProvider(target, context),
  },
};
