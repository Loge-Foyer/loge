import { useMutation, useQuery } from '@tanstack/react-query';

import type { WatchStatusSetting } from '@/services/account-settings';
import { deviceKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

/**
 * Which tabs the account keeps watch status on. The account's, not a
 * profile's — under the device's prefix, which a sync refreshes too.
 */
export function useWatchStatusSetting() {
  const { accountSettings } = useServices();
  return useQuery({ queryKey: deviceKey('account-settings', 'watchStatus'), queryFn: () => accountSettings.watchStatus() });
}

export function useAccountSettingActions() {
  const { accountSettings } = useServices();
  const refresh = useRefreshLocalState();
  return {
    // A profile's sources say who keeps their watch status, so they are read again too.
    setWatchStatus: useMutation({
      mutationFn: (change: Partial<WatchStatusSetting>) => accountSettings.setWatchStatus(change),
      networkMode: 'always',
      onSuccess: () => refresh(),
    }),
  };
}
