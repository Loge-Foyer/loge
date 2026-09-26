import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';

import type { ClientIdentity, ClientIdentitySource } from '@/services/ports';

const APP_NAME = 'Streaming Center';

/**
 * What servers see of this install. The device key has to stay the same
 * between launches, or a media server counts a new device every time:
 *
 * - on iOS and Android it comes from the platform's per-app identifier;
 * - in a development build the start script can pin it;
 * - on the web it lasts only as long as the page until storage exists.
 */
export function createClientIdentitySource(): ClientIdentitySource {
  let identity: Promise<ClientIdentity> | undefined;
  return {
    identity: () => (identity ??= load()),
  };
}

async function load(): Promise<ClientIdentity> {
  return {
    appName: APP_NAME,
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    deviceName: Constants.deviceName ?? defaultDeviceName(),
    deviceKey: await deviceKey(),
  };
}

async function deviceKey(): Promise<string> {
  const pinned = __DEV__ ? process.env.EXPO_PUBLIC_DEV_INSTALLATION_ID : undefined;
  if (pinned) return pinned;
  const platformId = await platformIdentifier();
  // Hashed, so the platform's own identifier never leaves the device.
  return platformId ? digestStringAsync(CryptoDigestAlgorithm.SHA256, `${APP_NAME}:${platformId}`) : randomUUID();
}

async function platformIdentifier(): Promise<string | null> {
  try {
    if (process.env.EXPO_OS === 'ios') return await Application.getIosIdForVendorAsync();
    if (process.env.EXPO_OS === 'android') return Application.getAndroidId();
  } catch {
    // Unavailable before first unlock, or on a platform without one.
  }
  return null;
}

function defaultDeviceName(): string {
  if (process.env.EXPO_OS === 'web') return 'Web browser';
  return process.env.EXPO_OS === 'ios' ? 'iPhone' : 'Android device';
}
