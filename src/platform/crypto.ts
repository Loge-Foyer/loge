import { getRandomBytes } from 'expo-crypto';

import { expoAes } from './expo-aes';
import { createPluginCrypto } from './plugin-crypto';

/** The plugins' cryptography: expo-crypto's AES-GCM and randomness — WebCrypto behind them in a browser. */
export const hostCrypto = createPluginCrypto({
  randomBytes: (length) => getRandomBytes(length),
  aes: expoAes,
});
