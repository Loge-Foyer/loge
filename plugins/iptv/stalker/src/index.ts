/**
 * Stalker — live TV, films and series from a Stalker (Ministra) portal, the
 * middleware behind many IPTV subscriptions for MAG boxes. A portal signs a
 * device in by its MAC address, so that address is kept like a password.
 *
 * IPTV runs on phones: portals send no CORS headers, and a browser will not
 * send the cookie a portal needs.
 */
import { pluginId, type Plugin } from '@sc/api';

import { createProvider } from './provider';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('iptv/stalker'),
    category: 'iptv',
    platforms: ['ios', 'android'],
    displayName: 'Stalker portal',
    description: 'Live TV, films and series from a Stalker portal, signed in with its MAC address.',
    media: { contentKinds: ['live', 'movies', 'shows'], capabilities: ['browse', 'channels', 'epg', 'playback', 'remoteImages'] },
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
      { key: 'signature', label: 'Signature', type: 'password', description: 'Only if your provider asks for one.' },
    ],
    settings: [],
  },
  media: {
    connect: async (target, context) => createProvider(target, context),
  },
};
