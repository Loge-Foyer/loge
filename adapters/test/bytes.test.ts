import { randomBytes } from 'node:crypto';

import { decodeBase64Url, decodeUtf8, encodeBase64, encodeBase64Url, encodeHex, encodeUtf8 } from '@loge/api';
import { describe, expect, it } from 'vitest';

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('base64', () => {
  // RFC 4648, section 10.
  const vectors = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ] as const;

  it('encodes the RFC’s vectors, padded', () => {
    for (const [text, encoded] of vectors) expect(encodeBase64(ascii(text))).toBe(encoded);
  });

  it('encodes base64url without padding, and decodes it back', () => {
    for (const [text, encoded] of vectors) {
      const url = encoded.replace(/=+$/, '');
      expect(encodeBase64Url(ascii(text))).toBe(url);
      expect(decodeBase64Url(url)).toEqual(ascii(text));
    }
  });

  it('uses the URL-safe alphabet only in base64url', () => {
    const bytes = Uint8Array.from([0xfb, 0xff]);
    expect(encodeBase64(bytes)).toBe('+/8=');
    expect(encodeBase64Url(bytes)).toBe('-_8');
  });

  it('matches Node for every length, both ways', () => {
    for (let length = 0; length <= 48; length += 1) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect(encodeBase64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
      expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('refuses what is not unpadded base64url, written the one way it can be', () => {
    for (const text of ['Zg==', 'Zm9v+', 'Zm9v/', 'Z', 'Zh', 'Zm9 v']) expect(decodeBase64Url(text), text).toBeUndefined();
  });
});

describe('hex', () => {
  it('matches Node for every byte', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(encodeHex(bytes)).toBe(Buffer.from(bytes).toString('hex'));
    expect(encodeHex(randomBytes(33))).toMatch(/^[0-9a-f]{66}$/);
  });
});

describe('UTF-8', () => {
  const texts = ['', 'plain', 'Jellyfin — Wohnzimmer', 'ümlaut é', '日本語', 'emoji 🎬🍿', 'é', '\u0000'];

  it('encodes as TextEncoder does, surrogate pairs included', () => {
    for (const text of texts) expect(encodeUtf8(text), text).toEqual(new TextEncoder().encode(text));
  });

  it('writes a lone surrogate as U+FFFD', () => {
    expect(encodeUtf8('a\uD800b')).toEqual(Uint8Array.from([0x61, 0xef, 0xbf, 0xbd, 0x62]));
  });

  it('decodes what it encodes', () => {
    for (const text of texts) expect(decodeUtf8(encodeUtf8(text)), text).toBe(text);
  });

  it('refuses bytes that are not well-formed UTF-8', () => {
    const malformed = [
      [0xc0, 0x80], // an overlong NUL
      [0xe0, 0x80, 0x80], // an overlong three-byte form
      [0xed, 0xa0, 0x80], // a surrogate
      [0xe2, 0x82], // cut short
      [0xf4, 0x90, 0x80, 0x80], // past U+10FFFF
      [0x80], // a continuation byte on its own
      [0xff],
    ];
    for (const bytes of malformed) expect(decodeUtf8(Uint8Array.from(bytes)), bytes.join(' ')).toBeUndefined();
  });
});
