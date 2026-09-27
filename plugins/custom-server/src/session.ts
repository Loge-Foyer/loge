import { decodeBase64Url, encodeBase64Url, isKdfParams, type KdfParams } from '@sc/api';

import { isRecord, kdfToWire, readKdf } from './wire';

/**
 * What the plugin keeps in its session, in the device-bound store: this
 * device's token, the vault key, and the key's parameters — so the owner
 * check derives without asking the server for them. Or a tombstone: the
 * server let this device go, and nothing signs in again until the user does.
 */
export type Session =
  | { readonly kind: 'live'; readonly token: string; readonly vaultKey: Uint8Array; readonly kdf: KdfParams }
  | { readonly kind: 'signed-out' };

export type LiveSession = Extract<Session, { kind: 'live' }>;

const VERSION = 1;
const VAULT_KEY_LENGTH = 32;

export function encodeSession(session: Session): string {
  return JSON.stringify(
    session.kind === 'signed-out'
      ? { v: VERSION, signedOut: true }
      : { v: VERSION, token: session.token, vault: encodeBase64Url(session.vaultKey), kdf: kdfToWire(session.kdf) },
  );
}

/** `undefined` for no session, or one this plugin did not write: it signs in again. */
export function decodeSession(raw: string | undefined): Session | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.v !== VERSION) return undefined;
  if (value.signedOut === true) return { kind: 'signed-out' };
  if (typeof value.token !== 'string' || value.token === '' || typeof value.vault !== 'string') return undefined;
  const vaultKey = decodeBase64Url(value.vault);
  const kdf = readKdf(value.kdf);
  if (vaultKey?.length !== VAULT_KEY_LENGTH || !isKdfParams(kdf)) return undefined;
  return { kind: 'live', token: value.token, vaultKey, kdf };
}
