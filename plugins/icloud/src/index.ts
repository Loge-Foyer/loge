/**
 * iCloud — media (files on iCloud Drive) and sync, one manifest. It uses the
 * device's own Apple account, so a connection needs no fields.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so both lists are empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('icloud'),
    displayName: 'iCloud',
    description: 'Video files from iCloud Drive, and a home for your state.',
    media: { contentKinds: ['files'], capabilities: [] },
    sync: { capabilities: [] },
    connectionFields: [],
    settings: [],
  },
};
