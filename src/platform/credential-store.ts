import type { Credentials, CredentialsRef } from '@sc/api';

import type { SecureCredentialStore } from '@/services/ports';

/**
 * Stand-in for the keychain (native) and encrypted IndexedDB (web). Secrets
 * live only in this map, which is exactly as private as the process — and just
 * as short-lived.
 */
export function createMemoryCredentialStore(): SecureCredentialStore {
  const entries = new Map<CredentialsRef, Credentials>();
  return {
    read: async (ref) => entries.get(ref),
    write: async (ref, credentials) => {
      entries.set(ref, { ...credentials });
    },
    delete: async (ref) => {
      entries.delete(ref);
    },
  };
}
