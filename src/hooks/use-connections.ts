import type { ConnectionId, ConnectionOwner, PluginId } from '@sc/api';
import { useMutation, useQuery } from '@tanstack/react-query';

import type { ConnectionDraft } from '@/services/connections';
import { userKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';
import { useActiveUserId } from './use-session';

/** The plugin's connections that are live for the active profile, and who owns them. */
export function usePluginConnections(pluginId: PluginId) {
  const userId = useActiveUserId();
  const { connections } = useServices();
  return useQuery({
    queryKey: userKey(userId, 'plugin-connections', pluginId),
    queryFn: async () => {
      const owner = await connections.liveOwner(pluginId, userId);
      return { owner, connections: await connections.list(owner, pluginId) };
    },
  });
}

export function useConnection(id: ConnectionId) {
  const userId = useActiveUserId();
  const { connections } = useServices();
  return useQuery({
    queryKey: userKey(userId, 'connection', id),
    queryFn: async () => {
      const connection = await connections.get(id);
      return connection ? { connection, savedSecrets: await connections.savedSecrets(id) } : null;
    },
  });
}

export function useConnectionActions() {
  const { connections } = useServices();
  const refresh = useRefreshLocalState();
  return {
    create: useMutation({
      mutationFn: ({ pluginId, owner, draft }: { pluginId: PluginId; owner: ConnectionOwner; draft: ConnectionDraft }) =>
        connections.create(pluginId, owner, draft),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, draft }: { id: ConnectionId; draft: ConnectionDraft }) => connections.update(id, draft),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: ConnectionId) => connections.remove(id), onSuccess: refresh }),
  };
}
