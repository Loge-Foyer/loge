/**
 * Your own server — the account for someone who wants neither Apple nor
 * Google: a Streaming Center sync server they run (streaming_center_sync).
 *
 * The account password never reaches the server. The device derives a proof
 * to sign in with and a key that wraps a random vault key, which the app
 * seals connections' passwords with; the server keeps a hash of the proof and
 * the wrapped key, and can open neither.
 */
import { pluginId, type Plugin } from '@sc/api';

import { createSyncProvider } from './provider';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/custom-server'),
    category: 'sync',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Your own server',
    description: 'A Streaming Center sync server you run yourself.',
    sync: {
      // Nothing else is journaled yet: watch progress, favourites and lists arrive with the code that carries them.
      capabilities: ['profile', 'preferences', 'providerConnections', 'sealedPasswords'],
      ownerProof: { fields: ['password'] },
      signUp: {
        fields: [
          {
            key: 'invite',
            label: 'Invite code',
            type: 'text',
            required: true,
            placeholder: 'ABCD-EFGH-JKMN',
            description: 'Made on the server with sc-sync invite. It works once.',
          },
        ],
      },
    },
    connectionFields: [
      {
        key: 'serverUrl',
        label: 'Server address',
        type: 'url',
        required: true,
        placeholder: 'https://sync.example.com',
        description: 'Use https anywhere but your home network: the whole household travels through it.',
      },
      { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    settings: [],
  },
  sync: {
    connect: async (target, context) => createSyncProvider(target, context),
  },
};
