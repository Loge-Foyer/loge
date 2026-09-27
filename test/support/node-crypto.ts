import { createCipheriv, createDecipheriv, hkdfSync, pbkdf2Sync, randomBytes } from 'node:crypto';

import type { PluginCrypto } from '@sc/api';

const NONCE = 12;
const TAG = 16;

/**
 * The host's crypto port on Node's own primitives — the same algorithms the
 * app runs on a phone, so a value sealed here opens there.
 */
export function nodeCrypto(): PluginCrypto {
  return {
    randomBytes: (length) => new Uint8Array(randomBytes(length)),
    deriveKey: async (password, params) =>
      new Uint8Array(pbkdf2Sync(Buffer.from(password.normalize('NFC'), 'utf8'), params.salt, params.iterations, 32, 'sha256')),
    expandKey: async (key, info, length) => new Uint8Array(hkdfSync('sha256', key, new Uint8Array(0), Buffer.from(info, 'utf8'), length)),
    seal: async (key, plaintext, context) => {
      const nonce = randomBytes(NONCE);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return new Uint8Array(Buffer.concat([nonce, body, cipher.getAuthTag()]));
    },
    open: async (key, sealed, context) => {
      if (sealed.length < NONCE + TAG) return undefined;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE));
        decipher.setAAD(Buffer.from(context, 'utf8'));
        decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
        return new Uint8Array(Buffer.concat([decipher.update(sealed.subarray(NONCE, sealed.length - TAG)), decipher.final()]));
      } catch {
        return undefined;
      }
    },
  };
}
