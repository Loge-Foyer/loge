import { pluginId, type Plugin } from '@sc/api';

/** Manifest only: no media role yet, so no capability is declared. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/onedrive'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: 'OneDrive',
    description: 'Video files from OneDrive.',
    media: { contentKinds: ['files'], capabilities: [] },
    connectionFields: [],
    settings: [],
  },
};
