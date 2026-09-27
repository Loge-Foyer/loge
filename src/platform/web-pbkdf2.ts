const KEY_BITS = 256;

/**
 * PBKDF2-HMAC-SHA256 to 32 bytes on WebCrypto — native in every browser, and
 * the page is always a secure one (`storage.web.ts`).
 */
export async function webPbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  // WebCrypto takes bytes backed by an ArrayBuffer of their own.
  const key = await crypto.subtle.importKey('raw', new Uint8Array(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}
