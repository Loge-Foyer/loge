import { pluginId, type Plugin } from '@loge/api';

/** Manifest only: no media role yet, so no capability is declared. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/google-drive'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Google Drive',
    description: 'Video files from Google Drive.',
    media: { contentKinds: ['files'], capabilities: [] },
    connectionFields: [],
    settings: [],
  },
};
