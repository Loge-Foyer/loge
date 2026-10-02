import type { PluginCrypto } from '@loge/api';

import { createPluginCrypto, type AesGcm } from '@/platform/plugin-crypto';

const NONCE = 12;
// WebCrypto takes bytes backed by an ArrayBuffer of their own.
const own = (bytes: Uint8Array) => new Uint8Array(bytes);

/**
 * AES-GCM on WebCrypto, taking additional data as base64 the way expo-crypto
 * does — what its web build runs, and what a phone must interoperate with.
 */
export const webCryptoAes: AesGcm = {
  encrypt: async (key, plaintext, additionalData) => {
    const iv = crypto.getRandomValues(new Uint8Array(NONCE));
    const imported = await crypto.subtle.importKey('raw', own(key), 'AES-GCM', false, ['encrypt']);
    const body = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: own(Buffer.from(additionalData, 'base64')) },
      imported,
      own(plaintext),
    );
    return new Uint8Array(Buffer.concat([iv, new Uint8Array(body)]));
  },
  decrypt: async (key, sealed, additionalData) => {
    const imported = await crypto.subtle.importKey('raw', own(key), 'AES-GCM', false, ['decrypt']);
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: own(sealed.subarray(0, NONCE)), additionalData: own(Buffer.from(additionalData, 'base64')) },
      imported,
      own(sealed.subarray(NONCE)),
    );
    return new Uint8Array(opened);
  },
};

/** The app's own crypto as a browser runs it — WebCrypto's AES, noble's SHA-256 and HKDF — on Node's WebCrypto. */
export function testCrypto(): PluginCrypto {
  return createPluginCrypto({
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    aes: webCryptoAes,
  });
}
