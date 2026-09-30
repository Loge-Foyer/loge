import { AppError } from '@sc/api';

import { createIndexedDbDatabase } from '@/persistence/indexeddb/database';
import { unavailableDatabase } from '@/persistence/unavailable';
import { createWebCredentialStore } from '@/platform/web-credentials';

import type { DeviceStorage, StorageDeps } from './device-storage';

/**
 * The web: IndexedDB, and secrets encrypted in IndexedDB. Never SQLite here:
 * expo-sqlite's web build is alpha and needs WebAssembly and COOP/COEP
 * headers from whatever serves the page.
 */
export function createStorage({ clock, log }: StorageDeps): DeviceStorage {
  // WebCrypto, which keeps the secrets, exists only on a secure page. Nothing
  // here asks a *source* to use TLS: from localhost, an http server works.
  if (!globalThis.isSecureContext) {
    const insecure = new AppError(
      'STORAGE_FAILURE',
      'Open Streaming Center over https, or from localhost. A browser keeps passwords safe only on a secure page.',
      { retry: 'never' },
    );
    const refuse = async (): Promise<never> => {
      throw insecure;
    };
    const nowhere = { read: refuse, write: refuse, delete: refuse };
    return { db: unavailableDatabase(insecure), credentials: nowhere, deviceBound: nowhere };
  }

  // Best effort: without it a browser may clear this site's storage when space runs low.
  void globalThis.navigator.storage?.persist?.().catch(() => undefined);

  const secrets = createWebCredentialStore({ indexedDB: globalThis.indexedDB, crypto: globalThis.crypto }, { log });
  return {
    db: createIndexedDbDatabase({ indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange }, 'streaming-center', {
      clock,
      log,
    }),
    // A browser's storage never moves to another device, so one store serves both roles.
    credentials: secrets,
    deviceBound: secrets,
  };
}
