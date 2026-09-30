import type { PluginId } from '@sc/api';
import { useMutation, useQuery } from '@tanstack/react-query';

import { deviceKey } from '@/services/query-keys';
import type { ContentTab } from '@/services/tab-content';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

/** This device's players, and which plays first. Device state: every profile sees the same. */
export function usePlayers() {
  const { players } = useServices();
  return useQuery({ queryKey: deviceKey('players'), queryFn: () => players.list() });
}

export function usePlayerActions() {
  const { players } = useServices();
  const refresh = useRefreshLocalState();
  return {
    setEnabled: useMutation({
      mutationFn: ({ id, enabled }: { id: PluginId; enabled: boolean }) => players.setEnabled(id, enabled),
      onSuccess: () => refresh(),
    }),
    setPreferred: useMutation({ mutationFn: (id: PluginId) => players.setPreferred(id), onSuccess: () => refresh() }),
    setFirstOn: useMutation({
      mutationFn: ({ id, tab, first }: { id: PluginId; tab: ContentTab; first: boolean }) => players.setFirstOn(id, tab, first),
      onSuccess: () => refresh(),
    }),
  };
}
