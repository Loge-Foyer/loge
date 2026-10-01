/**
 * Mock account — a pretend account on "your own server", held in memory and
 * keyed by its endpoint, so the account's flows can be exercised with no
 * server at all. Development builds only.
 */
import { pluginId, type Plugin } from '@sc/api';

import { createAccount } from './account';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/mock'),
    category: 'sync',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Mock account',
    description: 'A pretend account kept in memory, for working offline.',
    account: { signUp: { fields: [] } },
    connectionFields: [
      {
        key: 'endpoint',
        label: 'Endpoint',
        type: 'url',
        placeholder: 'mock://account',
        description: 'Names the pretend account; mock://household has profiles already.',
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
    ],
  },
  account: {
    connect: async (target, context) => createAccount(target, context),
  },
};
