import type { PluginId } from '@loge/api';

import { useServices } from './services-context';

/** A plugin that runs on this platform. The catalogue is fixed at build time, so nothing is fetched. */
export function usePluginManifest(id: PluginId) {
  return useServices().catalog.get(id);
}
