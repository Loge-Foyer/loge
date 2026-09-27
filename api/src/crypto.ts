import type { CancelSignal } from './http';

/**
 * How a password becomes a key: PBKDF2-HMAC-SHA256, which every platform the
 * app runs on computes natively. Plain JavaScript on a phone is far too slow
 * for any password hash worth having.
 */
export interface KdfParams {
  readonly algorithm: 'pbkdf2-sha256';
  readonly iterations: number;
  readonly salt: Uint8Array;
}

/**
 * What both sides hold a key's parameters to. Fewer iterations, and a proof
 * the server sees is cheap to guess a password from; many more, and a phone
 * keeps its owner waiting. 600k is OWASP's figure for PBKDF2-HMAC-SHA256.
 */
export const KDF_LIMITS = { minIterations: 600_000, maxIterations: 2_000_000, minSalt: 16, maxSalt: 64 } as const;

/** Whether parameters are PBKDF2's within `KDF_LIMITS`. A device checks every set before deriving anything. */
export function isKdfParams(value: unknown): value is KdfParams {
  if (typeof value !== 'object' || value === null) return false;
  const { algorithm, iterations, salt } = value as Readonly<Record<string, unknown>>;
  return (
    algorithm === 'pbkdf2-sha256' &&
    typeof iterations === 'number' &&
    Number.isInteger(iterations) &&
    iterations >= KDF_LIMITS.minIterations &&
    iterations <= KDF_LIMITS.maxIterations &&
    salt instanceof Uint8Array &&
    salt.length >= KDF_LIMITS.minSalt &&
    salt.length <= KDF_LIMITS.maxSalt
  );
}

/**
 * Cryptography, from the host: a plugin has no WebCrypto, and the app keeps
 * one implementation for every platform. Keys are 32 bytes.
 */
export interface PluginCrypto {
  randomBytes(length: number): Uint8Array;
  /** A 32-byte key from a password. Slow on purpose. The host normalizes the password (NFC) and encodes it as UTF-8. */
  deriveKey(password: string, params: KdfParams, signal?: CancelSignal): Promise<Uint8Array>;
  /** HKDF-SHA-256, without a salt: one key into others, each for its own `info`. */
  expandKey(key: Uint8Array, info: string, length: number): Promise<Uint8Array>;
  /** AES-256-GCM: nonce ‖ ciphertext ‖ 16-byte tag, the nonce fresh each time. `context` binds it to what it belongs to. */
  seal(key: Uint8Array, plaintext: Uint8Array, context: string): Promise<Uint8Array>;
  /** `undefined` unless sealed with this key and this context. */
  open(key: Uint8Array, sealed: Uint8Array, context: string): Promise<Uint8Array | undefined>;
}
