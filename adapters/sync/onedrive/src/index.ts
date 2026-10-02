import { pluginId, type Plugin } from '@loge/api';

/** Manifest only: the backup role arrives with its implementation. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/onedrive'),
    category: 'sync',
    platforms: ['ios', 'android', 'web'],
    displayName: 'OneDrive',
    description: 'Keeps your account’s backup in OneDrive.',
    backup: { location: 'OneDrive → Apps → Loge' },
    connectionFields: [],
    settings: [],
  },
};
