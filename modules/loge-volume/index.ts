import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { VolumeModule } from './types';

/**
 * The device's own media volume — the one its buttons move. Reached lazily,
 * and on a phone only: a television's volume is the television's, and its
 * build has none of this module.
 */
let module: VolumeModule | undefined;

export function nativeVolume(): VolumeModule | undefined {
  if (Platform.isTV || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return undefined;
  module ??= requireNativeModule<VolumeModule>('LogeVolume');
  return module;
}
