import * as SecureStore from 'expo-secure-store';

import { createSqliteDatabase } from '@/persistence/sqlite/database';
import { openExpoSqlite } from '@/persistence/sqlite/expo';
import { createKeychainCredentialStore } from '@/platform/keychain-credentials';

import type { DeviceStorage, StorageDeps } from './device-storage';

/** iOS and Android: SQLite, and the keychain. The web build uses `storage.web.ts`. */
export function createStorage({ clock, log }: StorageDeps): DeviceStorage {
  return {
    db: createSqliteDatabase(() => openExpoSqlite('loge.db', log), { clock, log }),
    credentials: createKeychainCredentialStore(SecureStore, {
      service: 'loge.credentials',
      accessible: SecureStore.AFTER_FIRST_UNLOCK,
      log,
    }),
    deviceBound: createKeychainCredentialStore(SecureStore, {
      service: 'loge.device',
      accessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      log,
    }),
  };
}
