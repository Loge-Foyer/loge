/**
 * Stalker — live TV, films and series from a Stalker (Ministra) portal, the
 * middleware behind many IPTV subscriptions for MAG boxes. A portal signs a
 * device in by its MAC address, so that address is kept like a password.
 *
 * IPTV runs on phones: portals send no CORS headers, and a browser will not
 * send the cookie a portal needs.
 */
import { pluginId, TIME_ZONES, type Plugin } from '@loge/api';

import { createProvider } from './provider';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('iptv/stalker'),
    category: 'iptv',
    platforms: ['ios', 'android'],
    displayName: 'Stalker portal',
    description: 'Live TV, films and series from a Stalker portal, signed in with its MAC address.',
    media: { contentKinds: ['live', 'movies', 'shows'], capabilities: ['browse', 'search', 'channels', 'epg', 'playback', 'remoteImages', 'offlineMetadata'] },
    connectionFields: [
      { key: 'portalUrl', label: 'Portal address', type: 'url', required: true, placeholder: 'http://portal.example.com/c/' },
      // The MAC address is what signs in: anyone with it and the portal's address
      // can use the subscription, so it is stored as a password. It is no secret
      // to whoever holds it, though, and typing one unseen is how it goes wrong —
      // so it is shown, as are the box's other ids.
      {
        key: 'mac',
        label: 'MAC address',
        type: 'password',
        visible: true,
        required: true,
        placeholder: '00:1A:79:00:00:00',
        description: 'The one your provider registered for you.',
      },
      { key: 'serialNumber', label: 'Serial number', type: 'password', visible: true, description: 'Only if your provider asks for one.' },
      { key: 'deviceId', label: 'Device id', type: 'password', visible: true, description: 'Only if your provider asks for one.' },
      { key: 'signature', label: 'Signature', type: 'password', visible: true, description: 'Only if your provider asks for one.' },
    ],
    settings: [
      {
        key: 'cacheMetadata',
        label: 'Keep channels and the guide on this device',
        type: 'boolean',
        default: true,
        description: 'So the channel list opens at once, and shows — saying how old it is — while the portal is away.',
        gates: ['media.offlineMetadata'],
      },
      {
        key: 'timeZone',
        label: 'Guide time zone',
        type: 'select',
        default: '',
        // Nothing changes until one is chosen: a portal whose guide is right stays right.
        options: [{ value: '', label: 'As the portal says' }, ...TIME_ZONES.map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }))],
        description:
          'If what is on now is off by an hour or more, choose the time zone the portal keeps its guide in — often its own. Summer time follows each programme’s date.',
      },
      {
        key: 'guideByCountry',
        label: 'Put other countries’ guides right',
        type: 'boolean',
        default: true,
        description:
          'A channel from another country than the portal’s own — its guide id ends in .tr, or its group starts with TR — can have a guide written in UTC that the portal takes for its own clock, hours early. Such a guide is read as UTC.',
      },
    ],
  },
  media: {
    connect: async (target, context) => createProvider(target, context),
  },
};
