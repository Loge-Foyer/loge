/**
 * Your own server — the account for someone who wants neither Apple nor
 * Google: PocketBase, run by the household itself (Foyer).
 *
 * The device signs in with PocketBase's own password sign-in and keeps its
 * session. Records move whole: every one on a pull, one all-or-nothing batch
 * on a push. Source and IPTV passwords travel in plain text, for now: the
 * server is the household's own.
 */
import { pluginId, type Plugin } from '@loge/api';

import { createAccount } from './account';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/custom-server'),
    category: 'sync',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Your own server',
    description: 'Keeps your account on Foyer, the server you run yourself.',
    account: {
      ownerProof: { fields: ['password'] },
      signUp: {
        fields: [
          {
            key: 'invite',
            label: 'Invite code',
            type: 'text',
            placeholder: 'ABCD-EFGH-JKMN-PQRS',
            description: 'Made on the server with its invite command, and good for one account. An open server needs none.',
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
        description: 'Use https anywhere but your home network: your sources’ passwords travel through it.',
      },
      { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    settings: [],
  },
  account: {
    connect: async (target, context) => createAccount(target, context),
  },
};
