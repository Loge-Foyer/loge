/**
 * Local — sync only, and a terminus rather than a transport: "this device
 * only" is an ordinary destination instead of a branch in the sync engine.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so the list is empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('local'),
    displayName: 'This device',
    description: 'Keeps your state on this device only.',
    sync: { capabilities: [] },
    connectionFields: [],
    settings: [],
  },
};
