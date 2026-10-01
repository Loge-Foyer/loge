import type { AppSettings, DeviceSettingsRepository } from './ports';

/**
 * What the app does by itself, as against what a plugin does: for now, whether
 * the player turns the phone on its side. Device-wide, like players — never
 * journaled, never carried to your server, never in a backup.
 */
export const APP_DEFAULTS: AppSettings = {
  // On: a film fills a phone held either way up, and the viewer does not have
  // to keep it level for the picture to stay the right way round.
  forceLandscape: true,
};

export interface AppSettingsService {
  get(): Promise<AppSettings>;
  set(change: Partial<AppSettings>): Promise<void>;
}

export function createAppSettingsService(deps: { readonly deviceSettings: DeviceSettingsRepository }): AppSettingsService {
  const { deviceSettings } = deps;
  return {
    get: async () => ({ ...APP_DEFAULTS, ...(await deviceSettings.get()).app }),
    set: async (change) => {
      await deviceSettings.update((current) => ({ ...current, app: { ...current.app, ...change } }));
    },
  };
}
