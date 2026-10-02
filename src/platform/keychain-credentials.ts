import type { Credentials, CredentialsRef } from '@loge/api';
import type * as SecureStore from 'expo-secure-store';

import type { Logger, SecureCredentialStore } from '@/services/ports';

/** The part of expo-secure-store this uses, passed in so the tests can hand over a fake keychain. */
export type Keychain = Pick<typeof SecureStore, 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'>;

/**
 * SecureStore accepts only letters, digits, `.`, `-` and `_` in a key, and a
 * session ref carries `:`. Every other character becomes `_` and six hex
 * digits, so two refs can never share a key.
 */
export function keychainKey(ref: CredentialsRef): string {
  let key = 'loge.';
  for (const char of ref) {
    key += /^[A-Za-z0-9.-]$/.test(char) ? char : `_${(char.codePointAt(0) ?? 0).toString(16).padStart(6, '0')}`;
  }
  return key;
}

/**
 * Secrets in the iOS keychain and the Android keystore. `accessible` decides
 * whether an entry comes back with an encrypted backup restored onto another
 * phone: passwords and PINs should, a session token or the device key must
 * not — another phone signing in with them would end this one's session.
 */
export function createKeychainCredentialStore(
  keychain: Keychain,
  options: { readonly service: string; readonly accessible: SecureStore.KeychainAccessibilityConstant; readonly log?: Logger },
): SecureCredentialStore {
  const where = { keychainService: options.service, keychainAccessible: options.accessible };
  return {
    // A value the keychain cannot give back — gone, unreadable, sealed by a
    // key the keystore lost — is as good as missing, which the app handles:
    // it asks for the password again rather than failing on every read.
    read: async (ref) => {
      try {
        const value = await keychain.getItemAsync(keychainKey(ref), where);
        return value === null ? undefined : (JSON.parse(value) as Credentials);
      } catch (error) {
        options.log?.warn('storage', 'A saved secret could not be read', { error: String(error) });
        return undefined;
      }
    },
    write: (ref, credentials) => keychain.setItemAsync(keychainKey(ref), JSON.stringify(credentials), where),
    delete: (ref) => keychain.deleteItemAsync(keychainKey(ref), where),
  };
}
