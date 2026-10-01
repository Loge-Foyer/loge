import * as Brightness from 'expo-brightness';

import type { ScreenBrightness } from '@/services/ports';

/**
 * The screen's own brightness, for the slider down one edge of the player.
 * Only this app's window is changed, and only while it is in front, so
 * nothing here outlives the player — the system puts it back.
 */
export const screenBrightness: ScreenBrightness = {
  get: async () => {
    try {
      return await Brightness.getBrightnessAsync();
    } catch {
      return undefined;
    }
  },
  set: async (value) => {
    try {
      await Brightness.setBrightnessAsync(Math.min(1, Math.max(0, value)));
    } catch {
      // A device that will not have its brightness set is not worth a failure
      // mid-film: the slider simply does nothing.
    }
  },
  restore: async () => {
    try {
      await Brightness.restoreSystemBrightnessAsync();
    } catch {
      // As above.
    }
  },
};
