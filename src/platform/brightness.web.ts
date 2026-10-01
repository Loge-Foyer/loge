import type { ScreenBrightness } from '@/services/ports';

// A page cannot change the screen's brightness, and should not try.
export const screenBrightness: ScreenBrightness = {
  get: async () => undefined,
  set: async () => undefined,
  restore: async () => undefined,
};
