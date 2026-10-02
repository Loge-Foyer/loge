import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { encodeUtf8, recordId, type RecordKind } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { testCrypto } from './support/crypto';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

// The vectors both sides test against: a record's id is what the server derives too.
const vectors = (
  JSON.parse(readFileSync(join(process.cwd(), 'node_modules/@loge/api/fixtures/account-records.json'), 'utf8')) as {
    recordIds: readonly { accountId: string; kind: RecordKind; key: string; id: string }[];
  }
).recordIds;

describe('host crypto — hashing', () => {
  // FIPS 180-2, appendix B.1, and the empty message.
  it('is SHA-256, to the standard’s vectors', async () => {
    expect(hex(await testCrypto().sha256(encodeUtf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(await testCrypto().sha256(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes what Node hashes, whatever the text', async () => {
    const text = 'profileValues/c1/u-é — 家族';
    expect(hex(await testCrypto().sha256(encodeUtf8(text)))).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  });

  it('derives the record ids the shared vectors give', async () => {
    expect(vectors.length).toBeGreaterThan(0);
    for (const vector of vectors) {
      expect(await recordId(testCrypto().sha256, vector.accountId, vector.kind, vector.key), `${vector.kind} ${vector.key}`).toBe(vector.id);
    }
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
    const sealed = await crypto.seal(key, plaintext, 'loge/sealed/v1|connection/c1|password');
    expect(sealed.length).toBe(12 + plaintext.length + 16);
    expect(await crypto.open(key, sealed, 'loge/sealed/v1|connection/c1|password')).toEqual(plaintext);
    expect(await crypto.open(key, sealed, 'loge/sealed/v1|connection/c2|password')).toBeUndefined();
    expect(await crypto.open(new Uint8Array(randomBytes(32)), sealed, 'loge/sealed/v1|connection/c1|password')).toBeUndefined();
    expect(await crypto.open(key, sealed.subarray(0, 20), 'loge/sealed/v1|connection/c1|password')).toBeUndefined();
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
    const context = 'loge/sealed/v1|profileValues/c1/u-é|password';
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
