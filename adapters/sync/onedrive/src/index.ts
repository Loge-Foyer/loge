import { pluginId, type Plugin } from '@sc/api';

/** Manifest only: the backup role arrives with its implementation. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/onedrive'),
    category: 'sync',
    platforms: ['ios', 'android', 'web'],
    displayName: 'OneDrive',
    description: 'Keeps your account’s backup in OneDrive.',
    backup: { location: 'OneDrive → Apps → Streaming Center' },
    connectionFields: [],
    settings: [],
  },
};
