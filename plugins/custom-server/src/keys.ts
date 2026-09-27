import {
  decodeBase64Url,
  encodeBase64Url,
  isKdfParams,
  KDF_LIMITS,
  type CancelSignal,
  type KdfParams,
  type PluginCrypto,
} from '@sc/api';

import { weakKey } from './errors';

// Fixed and versioned: a key made for one of these is never taken for another.
const PROOF = 'sc/custom-server/v1/proof';
const WRAP = 'sc/custom-server/v1/wrap';
const VAULT = 'sc/custom-server/v1/vault';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Both halves of what the account password gives. */
export interface AccountKeys {
  /** Sent to sign in and to prove the owner; the server keeps only its hash. */
  readonly proof: Uint8Array;
  /** Never leaves the device: it wraps the vault key. */
  readonly wrap: Uint8Array;
}

/** A new account's parameters: a fresh salt, and the iterations the floor asks for — a second or so on a phone. */
export function newKdf(crypto: PluginCrypto): KdfParams {
  return { algorithm: 'pbkdf2-sha256', iterations: KDF_LIMITS.minIterations, salt: crypto.randomBytes(SALT_LENGTH) };
}

/**
 * One slow derivation, split in two. Parameters under the floor are refused
 * before anything is derived: a server, or anyone between it and the device,
 * could otherwise ask for a proof that is cheap to guess the password from.
 */
export async function keysFrom(crypto: PluginCrypto, password: string, params: KdfParams, signal?: CancelSignal): Promise<AccountKeys> {
  if (!isKdfParams(params)) throw weakKey();
  const master = await crypto.deriveKey(password, params, signal);
  return { proof: await crypto.expandKey(master, PROOF, KEY_LENGTH), wrap: await crypto.expandKey(master, WRAP, KEY_LENGTH) };
}

export function newVaultKey(crypto: PluginCrypto): Uint8Array {
  return crypto.randomBytes(KEY_LENGTH);
}

/** The vault key as the server keeps it: opaque, and openable only with the password. */
export async function wrapVault(crypto: PluginCrypto, keys: AccountKeys, vaultKey: Uint8Array): Promise<string> {
  return encodeBase64Url(await crypto.seal(keys.wrap, vaultKey, VAULT));
}

/** `undefined` for anything the password did not wrap — never a key. */
export async function unwrapVault(crypto: PluginCrypto, keys: AccountKeys, wrapped: string): Promise<Uint8Array | undefined> {
  const bytes = decodeBase64Url(wrapped);
  const key = bytes && (await crypto.open(keys.wrap, bytes, VAULT));
  return key?.length === KEY_LENGTH ? key : undefined;
}
