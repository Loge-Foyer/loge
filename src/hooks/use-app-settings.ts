import { useMutation, useQuery } from '@tanstack/react-query';

import type { ButtonRow } from '@/services/app-settings';
import { deviceKey } from '@/services/query-keys';
import type { AppSettings, PlayerButton } from '@/services/ports';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

/** How this device behaves while something plays. Device state: every profile sees the same. */
export function useAppSettings() {
  const { appSettings } = useServices();
  return useQuery({ queryKey: deviceKey('app-settings'), queryFn: () => appSettings.get() });
}

export function useAppSettingActions() {
  const { appSettings } = useServices();
  const refresh = useRefreshLocalState();
  return {
    set: useMutation({
      mutationFn: (change: Partial<AppSettings>) => appSettings.set(change),
      onSuccess: () => refresh(),
    }),
    setButton: useMutation({
      mutationFn: ({ row, button, shown }: { row: ButtonRow; button: PlayerButton; shown: boolean }) => appSettings.setButton(row, button, shown),
      onSuccess: () => refresh(),
    }),
  };
}
