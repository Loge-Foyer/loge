import type { ConnectionId, PluginId } from '@sc/api';
import { useMutation, useQuery } from '@tanstack/react-query';

import type { ConnectionDraft } from '@/services/connections';
import { deviceKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

/** A plugin's connections, and which profiles each is live for. Device state: every profile sees the same list. */
export function usePluginConnections(pluginId: PluginId) {
  const { connections } = useServices();
  return useQuery({
    queryKey: deviceKey('connections', pluginId),
    queryFn: () => connections.list(pluginId),
  });
}

/** A connection with every profile's own values — the editor shows a tab for each. */
export function useConnection(id: ConnectionId) {
  const { connections } = useServices();
  return useQuery({
    queryKey: deviceKey('connection', id),
    queryFn: async () => (await connections.edit(id)) ?? null,
  });
}

export function useConnectionActions() {
  const { connections } = useServices();
  const refresh = useRefreshLocalState();
  // A connection's values decide what its source answers, so remote results go too.
  const refreshAll = () => refresh({ remote: true });
  return {
    create: useMutation({
      mutationFn: ({ pluginId, draft }: { pluginId: PluginId; draft: ConnectionDraft }) => connections.create(pluginId, draft),
      onSuccess: refreshAll,
    }),
    update: useMutation({
      mutationFn: ({ id, draft }: { id: ConnectionId; draft: ConnectionDraft }) => connections.update(id, draft),
      onSuccess: refreshAll,
    }),
    remove: useMutation({ mutationFn: (id: ConnectionId) => connections.remove(id), onSuccess: refreshAll }),
  };
}
