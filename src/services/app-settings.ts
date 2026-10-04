import { PLAYER_BUTTONS, type AppSettings, type DeviceSettingsRepository, type PlayerButton } from './ports';
import { CONTENT_TABS } from './tab-content';

const GB = 1024 * 1024 * 1024;

/**
 * What the app does by itself, as against what a plugin does: for now, whether
 * the player turns the phone on its side. Device-wide, like players — never
 * journaled, never carried to your server, never in a backup.
 */
export const APP_DEFAULTS: AppSettings = {
  openOn: 'media',
  // A phone is its owner's: it opens on the profile chosen first.
  alwaysChooseProfile: false,
  // On: a film fills a phone held either way up, and the viewer does not have
  // to keep it level for the picture to stay the right way round.
  forceLandscape: true,
  seekMs: 10_000,
  // What a player needs to hand and nothing else. "Next episode" is not here:
  // it appears by itself at the end, where it belongs.
  buttons: ['audio', 'subtitles', 'speed'],
  // Nothing floats over the picture unless it is asked for.
  topButtons: [],
  centreJump: 'seek',
  doubleTap: 'seek',
  // Where a thumb already is on a phone held on its side.
  leftSlider: 'brightness',
  rightSlider: 'volume',
  showRemaining: true,
  // Off: a hold that changes the speed surprises anyone who did not ask for it.
  holdRate: 1,
  pictureInPicture: true,
  backgroundPlayback: true,
  // A picture is better than none, so this stays as it was.
  softwareFallback: true,
  // Play and the eye say what they do; the words only crowd a phone's row.
  buttonLabels: 'symbols',
  // As the phone, the TV or the browser is set: it changes with the time of day there.
  appearance: 'system',
  // Each engine's own read-ahead, as before there was a choice.
  buffering: 'memory',
  bufferDiskBytes: GB,
};

/**
 * The defaults on this kind of device. A TV belongs to whoever picks up the
 * remote, so it asks who is watching every time; anything else is one
 * person's, and opens on their profile.
 */
export function appDefaults(device: { readonly tv: boolean }): AppSettings {
  return { ...APP_DEFAULTS, alwaysChooseProfile: device.tv };
}

/** What a press and hold may be set to. 1 is off. */
export const HOLD_RATES = [1, 1.5, 2, 2.5, 3, 4] as const;

/** A disk cache's limit moves in half gigabytes, from one half to eight. */
export const BUFFER_DISK_STEP = GB / 2;
export const BUFFER_DISK_MAX = 8 * GB;

/** What the seek buttons may be set to, in seconds. */
export const SEEK_CHOICES = [5, 10, 15, 30, 60] as const;

/** The two rows a button may sit in. */
export type ButtonRow = 'buttons' | 'topButtons';

export interface AppSettingsService {
  get(): Promise<AppSettings>;
  set(change: Partial<AppSettings>): Promise<void>;
  /** Puts a button in one of the two rows, or takes it out, keeping the row's own order. */
  setButton(row: ButtonRow, button: PlayerButton, shown: boolean): Promise<void>;
}

export function createAppSettingsService(deps: {
  readonly deviceSettings: DeviceSettingsRepository;
  /** This device's defaults, from `appDefaults`. */
  readonly defaults?: AppSettings;
}): AppSettingsService {
  const { deviceSettings, defaults = APP_DEFAULTS } = deps;
  return {
    get: async () => {
      const settings = { ...defaults, ...(await deviceSettings.get()).app };
      // The app opens by redirecting to this tab, so one it no longer has is never taken.
      return CONTENT_TABS.includes(settings.openOn) ? settings : { ...settings, openOn: defaults.openOn };
    },
    set: async (change) => {
      await deviceSettings.update((current) => ({ ...current, app: { ...current.app, ...change } }));
    },
    setButton: async (row, button, shown) => {
      await deviceSettings.update((current) => {
        const now = current.app?.[row] ?? defaults[row];
        // Kept in the order the list itself is in, so switching one off and on
        // again puts it back where it was rather than at the end.
        const next = shown ? PLAYER_BUTTONS.filter((each) => each === button || now.includes(each)) : now.filter((each) => each !== button);
        return { ...current, app: { ...current.app, [row]: next } };
      });
    },
  };
}
