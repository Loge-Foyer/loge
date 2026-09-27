import type { OwnerAuthentication } from '@/services/ports';

/** A browser cannot ask for the device's owner, so this build never loads the native module. */
export function createOwnerAuthentication(): OwnerAuthentication {
  return {
    available: async () => false,
    authenticate: async () => 'unavailable',
  };
}
