import type { LocalAuthenticationError } from 'expo-local-authentication';
import { Platform } from 'react-native';

import type { OwnerAnswer, OwnerAuthentication } from '@/services/ports';

// Loaded on first use: an Apple TV has no Face ID, no fingerprint and no
// passcode to ask for, its build has no expo-local-authentication, and
// importing it there would throw as the app starts.
const localAuthentication = () => import('expo-local-authentication');

/**
 * Face ID, a fingerprint, or the passcode behind them — whoever owns the
 * device. A passcode alone is enough: biometrics are only a faster way in.
 * The web build uses `owner-authentication.web.ts`; a TV, like a browser,
 * cannot ask, and the account's password is the only proof there.
 */
export function createOwnerAuthentication(): OwnerAuthentication {
  if (Platform.isTV) {
    return { available: async () => false, authenticate: async () => 'unavailable' };
  }
  return {
    available: async () => {
      const { getEnrolledLevelAsync, SecurityLevel } = await localAuthentication();
      return (await getEnrolledLevelAsync()) >= SecurityLevel.SECRET;
    },
    authenticate: async (reason) => {
      const result = await (await localAuthentication()).authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
      return result.success ? 'verified' : answerFor(result.error);
    },
  };
}

function answerFor(error: LocalAuthenticationError): OwnerAnswer {
  switch (error) {
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
    case 'user_fallback':
      return 'cancelled';
    case 'not_enrolled':
    case 'passcode_not_set':
    case 'not_available':
      return 'unavailable';
    default:
      return 'refused';
  }
}
