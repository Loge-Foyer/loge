import { Platform } from 'react-native';

import { nativePictureInPicture } from '../../modules/sc-pip';
import type { PictureInPicture } from '@/services/ports';

/**
 * Android shrinks the whole activity, so every engine gets it whatever it
 * draws with and the app arranges it once. On iPhone the system takes over a
 * layer instead, which only an engine with one can offer — so there this says
 * nothing and each engine answers for itself.
 */
export const pictureInPicture: PictureInPicture = {
  available: () => {
    if (Platform.OS !== 'android') return false;
    try {
      return nativePictureInPicture()?.isAvailable() ?? false;
    } catch {
      return false;
    }
  },
  setAutoEnter: (on) => {
    try {
      nativePictureInPicture()?.setAutoEnter(on);
    } catch {
      // An older Android has nothing to arrange ahead of time.
    }
  },
  subscribe: (listener) => {
    const module = nativePictureInPicture();
    if (!module) return () => undefined;
    const subscription = module.addListener('onModeChange', ({ inPictureInPicture }) => listener(inPictureInPicture));
    return () => subscription.remove();
  },
};
