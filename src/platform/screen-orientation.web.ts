import type { ScreenOrientationControl } from '@/services/ports';

// A browser turns with its window, and locks only in fullscreen: nothing to do.
export const screenOrientation: ScreenOrientationControl = {
  upright: async () => undefined,
  free: async () => undefined,
  landscape: async () => undefined,
};
