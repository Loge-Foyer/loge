/**
 * Cryptography, from the host: a plugin has no WebCrypto, and the app keeps
 * one implementation for every platform. Keys are 32 bytes.
 */
export interface PluginCrypto {
  randomBytes(length: number): Uint8Array;
  /** SHA-256 — for ids derived rather than chosen, such as a record's on your own server (`recordId`). */
  sha256(data: Uint8Array): Promise<Uint8Array>;
  /** HKDF-SHA-256, without a salt: one key into others, each for its own `info`. */
  expandKey(key: Uint8Array, info: string, length: number): Promise<Uint8Array>;
  /** AES-256-GCM: nonce ‖ ciphertext ‖ 16-byte tag, the nonce fresh each time. `context` binds it to what it belongs to. */
  seal(key: Uint8Array, plaintext: Uint8Array, context: string): Promise<Uint8Array>;
  /** `undefined` unless sealed with this key and this context. */
  open(key: Uint8Array, sealed: Uint8Array, context: string): Promise<Uint8Array | undefined>;
}
