import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { TvMenuModule } from './types';

/**
 * The Apple TV remote's Menu button, kept for the app while a pushed screen
 * needs it. Reached lazily, and on an Apple TV only: an iPhone has no Menu
 * button, and Android's Back reaches the app already.
 */
let module: TvMenuModule | null | undefined;

export function nativeTvMenu(): TvMenuModule | undefined {
  if (!Platform.isTV || Platform.OS !== 'ios') return undefined;
  // Optional: a build made before this module was added carries none, and Menu then pops the screen as it always did.
  module ??= requireOptionalNativeModule<TvMenuModule>('LogeTvMenu');
  return module ?? undefined;
}
