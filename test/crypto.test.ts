import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

import { encodeUtf8, KDF_LIMITS, TransportError, type KdfParams } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { webPbkdf2 } from '@/platform/web-pbkdf2';

import { testCrypto } from './support/crypto';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const params = (overrides: Partial<KdfParams> = {}): KdfParams => ({
  algorithm: 'pbkdf2-sha256',
  iterations: KDF_LIMITS.minIterations,
  salt: Uint8Array.from({ length: 16 }, (_, index) => index),
  ...overrides,
});

describe('host crypto — deriving keys', () => {
  // RFC 7914, section 11: the first 32 bytes of each 64-byte answer. What a
  // browser runs; the native module is held to the same vector on a phone.
  it('is PBKDF2-HMAC-SHA256, to the RFC’s vectors', async () => {
    expect(hex(await webPbkdf2(encodeUtf8('passwd'), encodeUtf8('salt'), 1))).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc',
    );
    expect(hex(await webPbkdf2(encodeUtf8('Password'), encodeUtf8('NaCl'), 80_000))).toBe(
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56',
    );
  });

  it('derives what Node derives, within the limits', async () => {
    const key = await testCrypto().deriveKey('correct horse battery staple', params());
    const node = pbkdf2Sync('correct horse battery staple', params().salt, KDF_LIMITS.minIterations, 32, 'sha256');
    expect(hex(key)).toBe(node.toString('hex'));
  });

  it('derives one key from a password however it was typed', async () => {
    const composed = await testCrypto().deriveKey('caf\u00e9', params());
    const decomposed = await testCrypto().deriveKey('cafe\u0301', params());
    expect(hex(decomposed)).toBe(hex(composed));
  });

  it('derives nothing weaker or heavier than both sides allow', async () => {
    for (const bad of [
      params({ iterations: KDF_LIMITS.minIterations - 1 }),
      params({ iterations: KDF_LIMITS.maxIterations + 1 }),
      params({ salt: new Uint8Array(4) }),
    ]) {
      await expect(testCrypto().deriveKey('password', bad)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    }
  });

  it('stops when told to, and hands back nothing it was stopped during', async () => {
    const before = new AbortController();
    before.abort();
    await expect(testCrypto().deriveKey('password', params(), before.signal)).rejects.toBeInstanceOf(TransportError);

    const during = new AbortController();
    const derivation = testCrypto().deriveKey('password', params({ iterations: KDF_LIMITS.maxIterations }), during.signal);
    setTimeout(() => during.abort(), 5);
    await expect(derivation).rejects.toBeInstanceOf(TransportError);
  });
});

describe('host crypto — expanding keys', () => {
  // RFC 5869, test case 3: SHA-256 with no salt and no info.
  it('is HKDF-SHA-256, to the RFC’s vector', async () => {
    const okm = await testCrypto().expandKey(new Uint8Array(22).fill(0x0b), '', 42);
    expect(hex(okm)).toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
  });

  it('gives each purpose its own key', async () => {
    const master = new Uint8Array(randomBytes(32));
    const proof = await testCrypto().expandKey(master, 'proof', 32);
    const wrap = await testCrypto().expandKey(master, 'wrap', 32);
    expect(hex(proof)).not.toBe(hex(wrap));
  });
});

describe('host crypto — sealing', () => {
  const key = new Uint8Array(randomBytes(32));
  const plaintext = encodeUtf8('family-secret');

  it('opens what it sealed, under the same key and context only', async () => {
    const crypto = testCrypto();
    const sealed = await crypto.seal(key, plaintext, 'sc/sealed/v1|connection/c1|password');
    expect(sealed.length).toBe(12 + plaintext.length + 16);
    expect(await crypto.open(key, sealed, 'sc/sealed/v1|connection/c1|password')).toEqual(plaintext);
    expect(await crypto.open(key, sealed, 'sc/sealed/v1|connection/c2|password')).toBeUndefined();
    expect(await crypto.open(new Uint8Array(randomBytes(32)), sealed, 'sc/sealed/v1|connection/c1|password')).toBeUndefined();
    expect(await crypto.open(key, sealed.subarray(0, 20), 'sc/sealed/v1|connection/c1|password')).toBeUndefined();
  });

  it('refuses a value with one byte changed', async () => {
    const crypto = testCrypto();
    const sealed = await crypto.seal(key, plaintext, 'context');
    for (const at of [0, 12, sealed.length - 1]) {
      const tampered = new Uint8Array(sealed);
      tampered[at] = (tampered[at] ?? 0) ^ 1;
      expect(await crypto.open(key, tampered, 'context'), `byte ${at}`).toBeUndefined();
    }
  });

  it('seals with a fresh nonce every time', async () => {
    const crypto = testCrypto();
    expect(hex(await crypto.seal(key, plaintext, 'context'))).not.toBe(hex(await crypto.seal(key, plaintext, 'context')));
  });

  // What a phone seals, a browser opens, and the other way round: nonce ‖ ciphertext ‖ tag, with the context as UTF-8.
  it('interoperates with any other AES-GCM', async () => {
    const context = 'sc/sealed/v1|profileValues/c1/u-é|password';
    const sealedHere = await testCrypto().seal(key, plaintext, context);
    const decipher = createDecipheriv('aes-256-gcm', key, sealedHere.subarray(0, 12));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(sealedHere.subarray(sealedHere.length - 16));
    expect(Buffer.concat([decipher.update(sealedHere.subarray(12, sealedHere.length - 16)), decipher.final()])).toEqual(Buffer.from(plaintext));

    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const sealedThere = Buffer.concat([nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    expect(await testCrypto().open(key, new Uint8Array(sealedThere), context)).toEqual(plaintext);
  });
});
