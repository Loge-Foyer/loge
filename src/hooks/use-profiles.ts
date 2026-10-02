import type { UserId } from '@loge/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deviceKey, userKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

export function useProfiles() {
  const { profiles } = useServices();
  return useQuery({ queryKey: deviceKey('profiles'), queryFn: () => profiles.list() });
}

export function useDefaultUserId() {
  const { profiles } = useServices();
  return useQuery({
    queryKey: deviceKey('default-user'),
    queryFn: async () => (await profiles.defaultUserId()) ?? null,
  });
}

export function useProfileActions() {
  const { profiles } = useServices();
  const client = useQueryClient();
  const refresh = useRefreshLocalState();

  return {
    create: useMutation({ mutationFn: (name: string) => profiles.create(name), onSuccess: () => refresh() }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: UserId; name: string }) => profiles.rename(id, name),
      onSuccess: () => refresh(),
    }),
    remove: useMutation({
      mutationFn: (id: UserId) => profiles.remove(id),
      onSuccess: async (_, id) => {
        client.removeQueries({ queryKey: userKey(id) });
        await refresh();
      },
    }),
    setDefault: useMutation({ mutationFn: (id: UserId) => profiles.setDefault(id), onSuccess: () => refresh() }),
  };
}
