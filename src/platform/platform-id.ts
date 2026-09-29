import type { PlatformId } from '@sc/api';
import { Platform } from 'react-native';

/** The platform plugins are chosen for. The app is built for these three alone. */
export function currentPlatform(): PlatformId {
  const os = Platform.OS;
  if (os === 'ios' || os === 'android' || os === 'web') return os;
  throw new Error(`Streaming Center does not run on ${os}.`);
}
