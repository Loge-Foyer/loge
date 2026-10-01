import { pluginId, type Plugin } from '@sc/api';

/** Manifest only: the backup role arrives with its implementation. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/icloud'),
    category: 'sync',
    platforms: ['ios'],
    displayName: 'iCloud',
    description: 'Keeps your account’s backup in iCloud Drive.',
    backup: { location: 'iCloud Drive → Streaming Center' },
    connectionFields: [],
    settings: [],
  },
};
