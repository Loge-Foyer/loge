import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AppError, encodeBase64, encodeUtf8, isKdfParams, TransportError, type PluginCrypto } from '@sc/api';

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

/** PBKDF2-HMAC-SHA256 to 32 bytes, natively: in plain JavaScript on Hermes it is a hundred times too slow. */
export type Pbkdf2 = (password: Uint8Array, salt: Uint8Array, iterations: number) => Promise<Uint8Array>;

const OVERHEAD = 12 + 16;

/**
 * The host's cryptography, one definition for every platform: the platform's
 * own PBKDF2, AES-GCM and randomness, and HKDF in JavaScript (noble) — a few
 * HMACs, cheap anywhere.
 */
export function createPluginCrypto(deps: {
  readonly randomBytes: (length: number) => Uint8Array;
  readonly pbkdf2: Pbkdf2;
  readonly aes: AesGcm;
}): PluginCrypto {
  const context = (text: string) => encodeBase64(encodeUtf8(text));

  return {
    randomBytes: (length) => deps.randomBytes(length),

    deriveKey: async (password, params, signal) => {
      // Whatever a plugin was told, nothing weaker or heavier is derived here.
      if (!isKdfParams(params)) throw new AppError('INVALID_STATE', 'The account asked for a key this app does not derive.', { retry: 'never' });
      if (signal?.aborted) throw new TransportError('aborted');
      const key = await deps.pbkdf2(encodeUtf8(password.normalize('NFC')), params.salt, params.iterations);
      // A native derivation cannot be stopped half-way; one the caller gave up on is not handed back.
      if (signal?.aborted) throw new TransportError('aborted');
      return key;
    },

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
