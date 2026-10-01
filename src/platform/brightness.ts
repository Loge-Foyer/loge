import { Platform } from 'react-native';

import type { ScreenBrightness } from '@/services/ports';

// Loaded on first use: an Apple TV build has no expo-brightness at all, and
// importing it there would throw as the app starts.
const brightness = () => import('expo-brightness');

/**
 * The screen's own brightness, for the slider down one edge of the player.
 * Only this app's window is changed, and only while it is in front, so
 * nothing here outlives the player — the system puts it back.
 */
const phone: ScreenBrightness = {
  get: async () => {
    try {
      return await (await brightness()).getBrightnessAsync();
    } catch {
      return undefined;
    }
  },
  set: async (value) => {
    try {
      await (await brightness()).setBrightnessAsync(Math.min(1, Math.max(0, value)));
    } catch {
      // A device that will not have its brightness set is not worth a failure
      // mid-film: the slider simply does nothing.
    }
  },
  restore: async () => {
    try {
      await (await brightness()).restoreSystemBrightnessAsync();
    } catch {
      // As above.
    }
  },
};

// A television's picture is the television's to set, not an app's.
const tv: ScreenBrightness = {
  get: async () => undefined,
  set: async () => undefined,
  restore: async () => undefined,
};

export const screenBrightness: ScreenBrightness = Platform.isTV ? tv : phone;
