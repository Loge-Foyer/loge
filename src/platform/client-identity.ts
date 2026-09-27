import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';

import type { ClientIdentity, ClientIdentitySource, Logger, SecureCredentialStore } from '@/services/ports';

import { loadDeviceKey } from './device-key';

const APP_NAME = 'Streaming Center';

/**
 * What servers see of this install. The device key is read from `deviceStore`
 * — the secure store that never moves to another phone — and made once.
 */
export function createClientIdentitySource(deviceStore: SecureCredentialStore, log: Logger): ClientIdentitySource {
  let identity: Promise<ClientIdentity> | undefined;
  return {
    identity: () => (identity ??= load(deviceStore, log)),
  };
}

async function load(store: SecureCredentialStore, log: Logger): Promise<ClientIdentity> {
  return {
    appName: APP_NAME,
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    deviceName: Constants.deviceName ?? defaultDeviceName(),
    deviceKey: await loadDeviceKey({
      store,
      platformId: platformIdentifier,
      // Hashed, so the platform's own identifier never leaves the device.
      derive: (platformId) => digestStringAsync(CryptoDigestAlgorithm.SHA256, `${APP_NAME}:${platformId}`),
      randomId: randomUUID,
      log,
    }),
  };
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
