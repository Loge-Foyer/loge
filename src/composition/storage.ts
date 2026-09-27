import * as SecureStore from 'expo-secure-store';

import { createSqliteDatabase } from '@/persistence/sqlite/database';
import { openExpoSqlite } from '@/persistence/sqlite/expo';
import { createKeychainCredentialStore } from '@/platform/keychain-credentials';

import type { DeviceStorage, StorageDeps } from './device-storage';

/** iOS and Android: SQLite, and the keychain. The web build uses `storage.web.ts`. */
export function createStorage({ clock, ids, log }: StorageDeps): DeviceStorage {
  return {
    db: createSqliteDatabase(() => openExpoSqlite('streaming-center.db', log), { clock, ids, log }),
    credentials: createKeychainCredentialStore(SecureStore, {
      service: 'sc.credentials',
      accessible: SecureStore.AFTER_FIRST_UNLOCK,
      log,
    }),
    deviceBound: createKeychainCredentialStore(SecureStore, {
      service: 'sc.device',
      accessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      log,
    }),
  };
}
