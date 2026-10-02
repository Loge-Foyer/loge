import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { encodeBase64, encodeUtf8, type PluginCrypto } from '@loge/api';

/**
 * AES-256-GCM as the platform offers it: expo-crypto on a phone, WebCrypto
 * behind it in a browser. `additionalData` is standard base64 — expo-crypto
 * reads a string as base64, and would turn bytes into one through `btoa`.
 */
export interface AesGcm {
  /** Nonce ‖ ciphertext ‖ 16-byte tag, the nonce fresh each time. */
  encrypt(key: Uint8Array, plaintext: Uint8Array, additionalData: string): Promise<Uint8Array>;
  /** Throws when it does not open. */
  decrypt(key: Uint8Array, sealed: Uint8Array, additionalData: string): Promise<Uint8Array>;
}

const OVERHEAD = 12 + 16;

/**
 * The host's cryptography, one definition for every platform: the platform's
 * own AES-GCM and randomness, and SHA-256 and HKDF in JavaScript (noble) — a
 * few rounds over a few bytes, cheap anywhere.
 */
export function createPluginCrypto(deps: { readonly randomBytes: (length: number) => Uint8Array; readonly aes: AesGcm }): PluginCrypto {
  const context = (text: string) => encodeBase64(encodeUtf8(text));

  return {
    randomBytes: (length) => deps.randomBytes(length),

    sha256: async (data) => sha256(data),

    expandKey: async (key, info, length) => hkdf(sha256, key, undefined, encodeUtf8(info), length),

    seal: (key, plaintext, text) => deps.aes.encrypt(key, plaintext, context(text)),

    open: async (key, sealed, text) => {
      if (sealed.length < OVERHEAD) return undefined;
      try {
        return await deps.aes.decrypt(key, sealed, context(text));
      } catch {
        return undefined;
      }
    },
  };
}
