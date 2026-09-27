import * as LocalAuthentication from 'expo-local-authentication';

import type { OwnerAnswer, OwnerAuthentication } from '@/services/ports';

/**
 * Face ID, a fingerprint, or the passcode behind them — whoever owns the
 * device. A passcode alone is enough: biometrics are only a faster way in.
 * The web build uses `owner-authentication.web.ts`.
 */
export function createOwnerAuthentication(): OwnerAuthentication {
  return {
    available: async () => (await LocalAuthentication.getEnrolledLevelAsync()) >= LocalAuthentication.SecurityLevel.SECRET,
    authenticate: async (reason) => {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
      return result.success ? 'verified' : answerFor(result.error);
    },
  };
}

function answerFor(error: LocalAuthentication.LocalAuthenticationError): OwnerAnswer {
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
