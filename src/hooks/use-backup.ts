import type { ConnectionId, Credentials } from '@sc/api';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';

import type { ConflictChoice, TargetStatus } from '@/services/backup/targets';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

/**
 * How each backup target stands: the same array until something changes.
 * `targets` — the connections' ids — reads them again when one is added or
 * removed.
 */
export function useBackupTargets(targets: readonly ConnectionId[]): readonly TargetStatus[] {
  const { backupTargets } = useServices();
  const key = targets.join('|');
  useEffect(() => {
    void backupTargets.load();
  }, [backupTargets, key]);
  return useSyncExternalStore(backupTargets.subscribe, backupTargets.status, backupTargets.status);
}

export function useBackupTargetActions() {
  const { backupTargets } = useServices();
  const refresh = useRefreshLocalState();
  return {
    saveNow: useMutation({ mutationFn: () => backupTargets.saveNow() }),
    // Opening theirs replaces the account: everything shown refreshes.
    resolve: useMutation({
      mutationFn: ({ id, choice, proof }: { id: ConnectionId; choice: ConflictChoice; proof?: Credentials }) => backupTargets.resolve(id, choice, proof),
      onSuccess: () => refresh({ remote: true }),
    }),
  };
}
