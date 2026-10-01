import { PLAYER_BUTTONS, type AppSettings, type DeviceSettingsRepository, type PlayerButton } from './ports';

/**
 * What the app does by itself, as against what a plugin does: for now, whether
 * the player turns the phone on its side. Device-wide, like players — never
 * journaled, never carried to your server, never in a backup.
 */
export const APP_DEFAULTS: AppSettings = {
  // On: a film fills a phone held either way up, and the viewer does not have
  // to keep it level for the picture to stay the right way round.
  forceLandscape: true,
  seekMs: 10_000,
  // What a player needs to hand and nothing else. "Next episode" is not here:
  // it appears by itself at the end, where it belongs.
  buttons: ['audio', 'subtitles', 'speed'],
};

/** What the seek buttons may be set to, in seconds. */
export const SEEK_CHOICES = [5, 10, 15, 30, 60] as const;

export interface AppSettingsService {
  get(): Promise<AppSettings>;
  set(change: Partial<AppSettings>): Promise<void>;
  /** Puts a button in the row, or takes it out, keeping the row's own order. */
  setButton(button: PlayerButton, shown: boolean): Promise<void>;
}

export function createAppSettingsService(deps: { readonly deviceSettings: DeviceSettingsRepository }): AppSettingsService {
  const { deviceSettings } = deps;
  return {
    get: async () => ({ ...APP_DEFAULTS, ...(await deviceSettings.get()).app }),
    set: async (change) => {
      await deviceSettings.update((current) => ({ ...current, app: { ...current.app, ...change } }));
    },
    setButton: async (button, shown) => {
      await deviceSettings.update((current) => {
        const now = current.app?.buttons ?? APP_DEFAULTS.buttons;
        // Kept in the order the list itself is in, so switching one off and on
        // again puts it back where it was rather than at the end.
        const buttons = shown ? PLAYER_BUTTONS.filter((each) => each === button || now.includes(each)) : now.filter((each) => each !== button);
        return { ...current, app: { ...current.app, buttons } };
      });
    },
  };
}
