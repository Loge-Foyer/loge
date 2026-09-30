/**
 * The backup key: 20 random bytes, shown as eight groups of four in Crockford
 * base32 and a checksum group — `7K3M-…-Q9DX`. It opens every password in a
 * backup, so it is kept in the device-bound store and shown only after the
 * owner check. Typed back in, it forgives: case, spaces and dashes do not
 * matter, and O, I and L read as 0, 1 and 1.
 */

export const BACKUP_KEY_BYTES = 20;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP = 4;
const KEY_CHARS = 32;
const CHECK_CHARS = 4;

/** Crockford base32, five bits a character, most significant first. */
export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) text += ALPHABET[(value << (5 - bits)) & 31];
  return text;
}

/** The bytes of whole characters only: 32 characters are exactly 20 bytes. */
export function decodeBase32(text: string): Uint8Array | undefined {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return undefined;
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8Array.from(bytes);
}

async function checkOf(key: Uint8Array, sha256: (data: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  return encodeBase32((await sha256(key)).subarray(0, 5)).slice(0, CHECK_CHARS);
}

/** The key as it is shown and typed: nine groups of four, the last a checksum. */
export async function formatBackupKey(key: Uint8Array, sha256: (data: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  if (key.length !== BACKUP_KEY_BYTES) throw new Error('A backup key is 20 bytes.');
  const text = encodeBase32(key) + (await checkOf(key, sha256));
  const groups: string[] = [];
  for (let at = 0; at < text.length; at += GROUP) groups.push(text.slice(at, at + GROUP));
  return groups.join('-');
}

export type KeyProblem = 'malformed' | 'mistyped';

/** What was typed, forgiven where it can be: the key, or why it is not one. */
export async function parseBackupKey(text: string, sha256: (data: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array | KeyProblem> {
  const cleaned = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== KEY_CHARS + CHECK_CHARS) return 'malformed';
  const key = decodeBase32(cleaned.slice(0, KEY_CHARS));
  if (!key || key.length !== BACKUP_KEY_BYTES || [...cleaned.slice(KEY_CHARS)].some((char) => !ALPHABET.includes(char))) return 'malformed';
  return (await checkOf(key, sha256)) === cleaned.slice(KEY_CHARS) ? key : 'mistyped';
}
