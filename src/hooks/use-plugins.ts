import type { PluginId } from '@sc/api';
import { useMutation, useQuery } from '@tanstack/react-query';

import { PLUGIN_OFF } from '@/services/device-plugins';
import { deviceKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

export function usePluginManifest(id: PluginId) {
  return useServices().catalog.get(id);
}

/** Device state for every registered plugin: whether it is installed. */
export function usePluginStates() {
  const { catalog, devicePlugins } = useServices();
  return useQuery({
    queryKey: deviceKey('plugins'),
    queryFn: async () => {
      const states = await devicePlugins.states();
      return new Map(catalog.list().map(({ id }) => [id, states[id] ?? PLUGIN_OFF] as const));
    },
  });
}

export function usePluginActions() {
  const { devicePlugins } = useServices();
  const refresh = useRefreshLocalState();
  return {
    setEnabled: useMutation({
      mutationFn: ({ id, enabled }: { id: PluginId; enabled: boolean }) =>
        devicePlugins.setEnabled(id, enabled),
      onSuccess: () => refresh({ remote: true }),
    }),
  };
}
