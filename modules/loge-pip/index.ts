import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { PictureInPictureModule } from './types';

/**
 * Android's picture in picture, which belongs to the activity rather than to
 * any engine. Reached lazily, and absent everywhere else: on iPhone the system
 * takes over a layer, so each engine offers it for itself.
 */
let module: PictureInPictureModule | undefined;

export function nativePictureInPicture(): PictureInPictureModule | undefined {
  if (Platform.OS !== 'android') return undefined;
  module ??= requireNativeModule<PictureInPictureModule>('LogePip');
  return module;
}
