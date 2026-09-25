/**
 * Google — media (files on Drive) and sync, one manifest. Signing in is an
 * OAuth flow that arrives with the implementation, so there are no fields yet.
 *
 * Capabilities are declared together with their implementation. None exists
 * yet, so both lists are empty and nothing will ask this plugin to act.
 */
import { pluginId, type Plugin } from '@sc/api';

export const plugin: Plugin = {
  manifest: {
    id: pluginId('google'),
    displayName: 'Google Drive',
    description: 'Video files from Google Drive, and a home for your state.',
    media: { contentKinds: ['files'], capabilities: [] },
    sync: { capabilities: [] },
    connectionFields: [],
    settings: [],
  },
};
