import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { isRemoteKey } from '@/services/query-keys';

/**
 * After a local write: refresh device-level and profile-level entries. A
 * profile's sources depend on device state (installed plugins, connections),
 * so both prefixes go together. What servers answered is left alone — a
 * renamed profile needs no server — unless `remote` says the write changed a
 * source.
 */
export function useRefreshLocalState(): (options?: { remote?: boolean }) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (options?: { remote?: boolean }) => {
      const local = { predicate: (query: { queryKey: readonly unknown[] }) => !isRemoteKey(query.queryKey) };
      await Promise.all([
        client.invalidateQueries({ queryKey: ['device'], ...local }),
        client.invalidateQueries({ queryKey: ['user'], ...(options?.remote ? {} : local) }),
      ]);
    },
    [client],
  );
}
