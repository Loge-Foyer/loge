import { pluginId, type Plugin } from '@sc/api';

/**
 * Manifest only: no media role yet, so no capability is declared. IPTV runs on
 * phones: providers rarely send CORS headers, so a browser cannot reach them.
 */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('iptv/stalker'),
    category: 'iptv',
    platforms: ['ios', 'android'],
    displayName: 'Stalker portal',
    description: 'Live TV, films and series from a Stalker portal, signed in with its MAC address.',
    media: { contentKinds: ['live', 'movies', 'shows'], capabilities: [] },
    connectionFields: [
      { key: 'portalUrl', label: 'Portal address', type: 'url', required: true, placeholder: 'http://portal.example.com/c/' },
      // The MAC address is what signs in: anyone with it and the portal's address can use the subscription.
      {
        key: 'mac',
        label: 'MAC address',
        type: 'password',
        required: true,
        placeholder: '00:1A:79:00:00:00',
        description: 'The one your provider registered for you. Kept like a password.',
      },
      { key: 'serialNumber', label: 'Serial number', type: 'password', description: 'Only if your provider asks for one.' },
      { key: 'deviceId', label: 'Device id', type: 'password', description: 'Only if your provider asks for one.' },
    ],
    settings: [],
  },
};
