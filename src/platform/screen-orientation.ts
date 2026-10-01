import { Platform } from 'react-native';

import type { ScreenOrientationControl } from '@/services/ports';

// Loaded on first use: an Apple TV build has no expo-screen-orientation, and
// importing it there would throw as the app starts.
const orientation = () => import('expo-screen-orientation');

/** Upright, as the app is laid out, except while something plays. */
const phone: ScreenOrientationControl = {
  upright: async () => {
    const { lockAsync, OrientationLock } = await orientation();
    await lockAsync(OrientationLock.PORTRAIT_UP);
  },
  free: async () => (await orientation()).unlockAsync(),
  // Either way up, so the phone can still be turned end for end while it plays.
  landscape: async () => {
    const { lockAsync, OrientationLock } = await orientation();
    await lockAsync(OrientationLock.LANDSCAPE);
  },
};

// A television does not turn.
const tv: ScreenOrientationControl = {
  upright: async () => undefined,
  free: async () => undefined,
  landscape: async () => undefined,
};

export const screenOrientation: ScreenOrientationControl = Platform.isTV ? tv : phone;
