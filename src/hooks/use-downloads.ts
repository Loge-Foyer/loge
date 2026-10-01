import type { GlobalMediaKey, MediaItem } from '@sc/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deviceKey, userKey } from '@/services/query-keys';
import type { DownloadSettings } from '@/services/ports';

import { useServices } from './services-context';
import { useActiveUserId } from './use-session';

const DOWNLOADS = 'downloads';
/** While something is fetching, the rows move: often enough to watch, rarely enough not to churn. */
const WHILE_RUNNING_MS = 1_500;

/** What this profile has kept on this device. */
export function useDownloads() {
  const userId = useActiveUserId();
  const { downloads } = useServices();
  return useQuery({
    queryKey: userKey(userId, DOWNLOADS),
    queryFn: () => downloads.list(userId),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((entry) => entry.state === 'running' || entry.state === 'queued') ? WHILE_RUNNING_MS : false,
  });
}

/** The copy of one item, if this profile kept one. */
export function useDownloadOf(key: GlobalMediaKey | undefined) {
  const userId = useActiveUserId();
  const { downloads } = useServices();
  return useQuery({
    queryKey: userKey(userId, DOWNLOADS, key?.connectionId, key?.externalId),
    // Nothing kept is null: a query may not answer undefined.
    queryFn: async () => (key ? ((await downloads.forItem(userId, key)) ?? null) : null),
    enabled: key !== undefined,
    refetchInterval: (query) => {
      const entry = query.state.data;
      return entry && (entry.state === 'running' || entry.state === 'queued') ? WHILE_RUNNING_MS : false;
    },
  });
}

/** How much room is left, from the disk rather than the rows. */
export function useDownloadBudget() {
  const { downloads } = useServices();
  return useQuery({ queryKey: deviceKey(DOWNLOADS, 'budget'), queryFn: () => downloads.budget() });
}

/** The versions a source will hand over — asked only when a sheet is open. */
export function useDownloadOptions(key: GlobalMediaKey | undefined, enabled: boolean) {
  const userId = useActiveUserId();
  const { downloads } = useServices();
  return useQuery({
    queryKey: userKey(userId, DOWNLOADS, 'options', key?.connectionId, key?.externalId),
    queryFn: ({ signal }) => (key ? downloads.options(userId, key, signal) : []),
    enabled: enabled && key !== undefined,
    staleTime: 5 * 60_000,
  });
}

export function useDownloadSettings() {
  const { downloadSettings } = useServices();
  return useQuery({ queryKey: deviceKey(DOWNLOADS, 'settings'), queryFn: () => downloadSettings.get() });
}

export function useDownloadActions() {
  const userId = useActiveUserId();
  const { downloads, downloadSettings } = useServices();
  const client = useQueryClient();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: userKey(userId, DOWNLOADS) });
    await client.invalidateQueries({ queryKey: deviceKey(DOWNLOADS) });
  };
  return {
    start: useMutation({
      mutationFn: ({ item, optionId }: { item: MediaItem; optionId?: string }) => downloads.start(userId, item, optionId),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => downloads.remove(id), onSuccess: refresh }),
    pause: useMutation({ mutationFn: (id: string) => downloads.pause(id), onSuccess: refresh }),
    resume: useMutation({ mutationFn: (id: string) => downloads.resume(id), onSuccess: refresh }),
    set: useMutation({
      mutationFn: (change: Partial<DownloadSettings>) => downloadSettings.set(change),
      onSuccess: refresh,
    }),
  };
}
