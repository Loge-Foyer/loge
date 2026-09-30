import * as ScreenOrientation from 'expo-screen-orientation';

import type { ScreenOrientationControl } from '@/services/ports';

/** Upright, as the app is laid out, except while something plays. */
export const screenOrientation: ScreenOrientationControl = {
  upright: () => ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP),
  free: () => ScreenOrientation.unlockAsync(),
};
