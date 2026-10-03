import { useMutation, useQuery } from '@tanstack/react-query';

import type { ButtonRow } from '@/services/app-settings';
import { deviceKey } from '@/services/query-keys';
import type { AppSettings, PlayerButton } from '@/services/ports';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';
import { useGate } from './use-session';

/** How this device behaves. Device state: every profile sees the same. */
export function useAppSettings({ enabled = true }: { enabled?: boolean } = {}) {
  const { appSettings } = useServices();
  return useQuery({ queryKey: deviceKey('app-settings'), queryFn: () => appSettings.get(), enabled });
}

/**
 * This device's settings for what draws the app before any screen does — the
 * theme, the splash — read once the gate has settled, when the database is
 * open and up to date. `known` once they are read, or once nothing will be.
 */
export function useStartedAppSettings() {
  const gate = useGate();
  const started = gate.kind !== 'starting' && gate.kind !== 'failed';
  const query = useAppSettings({ enabled: started });
  return { settings: query.data, known: gate.kind === 'failed' || query.data !== undefined || query.isError } as const;
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
