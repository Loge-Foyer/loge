/**
 * Bytes as text, and text as bytes, written out by hand: plugins have no `btoa`
 * or `TextEncoder`, and nothing that runs on a phone should depend on Hermes
 * having them. `Uint8Array.prototype.toBase64` typechecks, but neither Node 24
 * nor Hermes has it.
 */

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Standard base64, padded. */
export function encodeBase64(bytes: Uint8Array): string {
  return encode(bytes, STANDARD, true);
}

/** Base64url without padding — safe in a URL, in JSON, and between dots. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return encode(bytes, URL_SAFE, false);
}

/** `undefined` unless `text` is unpadded base64url, written the one way it can be. */
export function decodeBase64Url(text: string): Uint8Array | undefined {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < text.length; i += 1) {
    buffer = (buffer << 6) | URL_SAFE.indexOf(text.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index] = (buffer >> bits) & 0xff;
      index += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  // Bits left over must be zero, or two texts would decode to the same bytes.
  return buffer === 0 ? bytes : undefined;
}

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let text = '';
  const digit = (value: number) => alphabet.charAt(value & 63);
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    text += digit(n >> 18) + digit(n >> 12) + digit(n >> 6) + digit(n);
  }
  if (bytes.length - i === 1) {
    const n = (bytes[i] ?? 0) << 16;
    text += digit(n >> 18) + digit(n >> 12) + (pad ? '==' : '');
  } else if (bytes.length - i === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    text += digit(n >> 18) + digit(n >> 12) + digit(n >> 6) + (pad ? '=' : '');
  }
  return text;
}

/** UTF-8, with a lone surrogate written as U+FFFD — as `TextEncoder` writes it. */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let code = char.codePointAt(0) ?? 0xfffd;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(bytes);
}

/** `undefined` unless `bytes` are well-formed UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  let text = '';
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i] ?? 0;
    const size = first < 0x80 ? 1 : first >= 0xc2 && first < 0xe0 ? 2 : first >= 0xe0 && first < 0xf0 ? 3 : first >= 0xf0 && first < 0xf5 ? 4 : 0;
    if (size === 0 || i + size > bytes.length) return undefined;
    let code = size === 1 ? first : first & (0xff >> (size + 1));
    for (let k = 1; k < size; k += 1) {
      const next = bytes[i + k] ?? 0;
      if ((next & 0xc0) !== 0x80) return undefined;
      code = (code << 6) | (next & 0x3f);
    }
    // Overlong forms, surrogates and anything past U+10FFFF are not UTF-8.
    if ((size === 3 && code < 0x800) || (size === 4 && (code < 0x10000 || code > 0x10ffff))) return undefined;
    if (code >= 0xd800 && code <= 0xdfff) return undefined;
    text += String.fromCodePoint(code);
    i += size;
  }
  return text;
}
