/**
 * Mock account — a pretend account, held in memory and keyed by its endpoint,
 * so the account's flows can be exercised with no server at all. It declines
 * some capabilities on purpose: sealed passwords, so the app's way of asking
 * for a missing password stays exercised.
 */
import { pluginId, type Plugin } from '@sc/api';

import { createSyncProvider } from './sync';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/mock'),
    category: 'sync',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Mock account',
    description: 'A pretend account kept in memory, for working offline.',
    sync: { capabilities: ['profile', 'preferences', 'providerConnections'] },
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
  sync: {
    connect: async (target, context) => createSyncProvider(target, context),
  },
};
