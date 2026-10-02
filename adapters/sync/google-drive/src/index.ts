import { pluginId, type Plugin } from '@loge/api';

/** Manifest only: the backup role arrives with its implementation. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/google-drive'),
    category: 'sync',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Google Drive',
    description: 'Keeps your account’s backup in Google Drive.',
    backup: { location: 'Google Drive → Loge' },
    connectionFields: [],
    settings: [],
  },
};
