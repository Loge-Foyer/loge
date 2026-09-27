import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

import type { AesGcm } from './plugin-crypto';

/** expo-crypto's AES-GCM: native on a phone, WebCrypto in a browser. */
export const expoAes: AesGcm = {
  encrypt: async (key, plaintext, additionalData) => {
    const sealed = await aesEncryptAsync(plaintext, await AESEncryptionKey.import(key), { additionalData });
    return sealed.combined();
  },
  decrypt: async (key, sealed, additionalData) =>
    aesDecryptAsync(AESSealedData.fromCombined(sealed), await AESEncryptionKey.import(key), { output: 'bytes', additionalData }),
};
