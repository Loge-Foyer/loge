import { getRandomBytes } from 'expo-crypto';

import { expoAes } from './expo-aes';
import { createPluginCrypto } from './plugin-crypto';
import { webPbkdf2 } from './web-pbkdf2';

/** The plugins' cryptography in a browser: WebCrypto's PBKDF2, and expo-crypto's AES-GCM (WebCrypto too) and randomness. */
export const hostCrypto = createPluginCrypto({
  randomBytes: (length) => getRandomBytes(length),
  pbkdf2: webPbkdf2,
  aes: expoAes,
});
