import type { Credentials } from '@sc/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';

import { deviceKey, userKey } from '@/services/query-keys';
import type { SyncStatus } from '@/services/sync/engine';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

/** How the account stands: the same object until something changes. */
export function useSyncStatus(): SyncStatus {
  const { sync } = useServices();
  return useSyncExternalStore(sync.subscribe, sync.status, sync.status);
}

/** The device's account, or `null`. Device state: every profile sees the same one. */
export function useAccount() {
  const { account } = useServices();
  return useQuery({ queryKey: deviceKey('account'), queryFn: async () => (await account.current()) ?? null });
}

/** How many profiles the account may hold: ten on this device, or what your server says. */
export function useMaxProfiles() {
  const { account } = useServices();
  return useQuery({ queryKey: deviceKey('account', 'max-profiles'), queryFn: () => account.maxProfiles() });
}

/** Profiles your server refused for its limit, kept on this device only. */
export function useHeldBackProfiles() {
  const { account } = useServices();
  return useQuery({ queryKey: deviceKey('account', 'held-back'), queryFn: () => account.heldBack() });
}

/**
 * How the owner would be asked, if at all. Asked again on every visit and on
 * coming back to the app: Face ID may have been set up in the meantime.
 */
export function useOwnerMethod() {
  const { owner } = useServices();
  return useQuery({ queryKey: deviceKey('owner-method'), queryFn: () => owner.method(), staleTime: 0 });
}

export function useAccountActions() {
  const { account, sync } = useServices();
  const refresh = useRefreshLocalState();
  return {
    // Signing out keeps everything here, as an account of its own.
    signOut: useMutation({ mutationFn: (proof?: Credentials) => account.signOut(proof), onSuccess: () => refresh({ remote: true }) }),
    syncNow: useMutation({ mutationFn: () => sync.now() }),
  };
}

/**
 * Mounted once, at the root — Welcome is outside `(app)`, and an account's
 * profiles arrive there too. What the account brought refreshes what screens
 * show; a removed profile's cache goes with it.
 */
export function useSyncEffects() {
  const { sync } = useServices();
  const client = useQueryClient();
  const refresh = useRefreshLocalState();
  useEffect(
    () =>
      sync.onApplied((applied) => {
        for (const userId of applied.removedProfiles) client.removeQueries({ queryKey: userKey(userId) });
        // A connection's values decide what its source answers, so remote results go too.
        void refresh({ remote: applied.connections.size > 0 });
      }),
    [client, refresh, sync],
  );
}
