import type { PlatformId } from '@sc/api';
import { Platform } from 'react-native';

/**
 * Whether this is a TV — tvOS, or Android TV. Plugins are chosen by platform
 * alone, so an Apple TV runs what an iPhone does; this is for what the app
 * itself does differently in front of a sofa.
 */
export function isTV(): boolean {
  return Platform.isTV === true;
}

/** The platform plugins are chosen for. The app is built for these three alone. */
export function currentPlatform(): PlatformId {
  const os = Platform.OS;
  if (os === 'ios' || os === 'android' || os === 'web') return os;
  throw new Error(`Streaming Center does not run on ${os}.`);
}
