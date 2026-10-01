import { pluginId, type Plugin } from '@sc/api';

/** Manifest only: no media role yet, so no capability is declared. */
export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/icloud-drive'),
    category: 'sources',
    platforms: ['ios'],
    displayName: 'iCloud Drive',
    description: 'Video files from iCloud Drive.',
    media: { contentKinds: ['files'], capabilities: [] },
    connectionFields: [],
    settings: [],
  },
};
