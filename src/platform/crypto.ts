import { getRandomBytes } from 'expo-crypto';

import KeyDerivation from '../../modules/key-derivation/src/KeyDerivationModule';

import { expoAes } from './expo-aes';
import { createPluginCrypto } from './plugin-crypto';

/** The plugins' cryptography on a phone: this app's native PBKDF2, and expo-crypto's AES-GCM and randomness. */
export const hostCrypto = createPluginCrypto({
  randomBytes: (length) => getRandomBytes(length),
  pbkdf2: (password, salt, iterations) => KeyDerivation.pbkdf2Sha256(password, salt, iterations, 32),
  aes: expoAes,
});
