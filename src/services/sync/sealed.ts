import {
  decodeBase64Url,
  decodeUtf8,
  encodeBase64Url,
  encodeUtf8,
  resolveValues,
  type Connection,
  type ConnectionValues,
  type PluginCrypto,
  type PluginId,
  type PluginManifest,
} from '@sc/api';

import { stableJson } from '../hash';

/** The account's vault key, and the short id every value sealed with it carries. */
export interface Vault {
  readonly key: Uint8Array;
  readonly kid: string;
}

/** Where a run gets the vault from — asked only when something needs sealing or opening. */
export type VaultSource = () => Promise<Vault>;

const VERSION = 'v1';
// isSyncChange refuses a sealed value longer than this, and would drop its whole change with it.
const MAX_SEALED = 4 * 1024;

export async function openVault(crypto: PluginCrypto, key: Uint8Array): Promise<Vault> {
  // An id, not the key: a later re-keying can tell values sealed with another key apart.
  const kid = encodeBase64Url(await crypto.expandKey(key, 'sc/kid/v1', 4));
  return { key, kid };
}

/** A vault source that opens `key` once, the first time it is asked. */
export function vaultOnce(crypto: PluginCrypto, key: () => Promise<Uint8Array>): VaultSource {
  let opened: Promise<Vault> | undefined;
  return () => (opened ??= key().then((bytes) => openVault(crypto, bytes)));
}

/**
 * What a password signs in to: its plugin, and its scope's address and
 * account — the `url` fields and the credential fields. A password is only
 * ever used with the sign-in it was saved for; a change that points it
 * anywhere else leaves it behind. Other fields are left out, or every toggle
 * would make other devices ask for their passwords again.
 */
export function signInOf(pluginId: PluginId, manifest: PluginManifest | undefined, fields: ConnectionValues['fields']): string {
  const keys = (manifest?.connectionFields ?? [])
    .filter((field) => field.type === 'url' || (field.type === 'text' && field.credential === true))
    .map((field) => field.key);
  return stableJson({ plugin: pluginId, fields: Object.fromEntries(keys.map((key) => [key, fields[key] ?? null])) });
}

/** The sign-in of a profile's own values on a connection, resolved over the connection as it stands. */
export function profileSignInOf(
  connection: Pick<Connection, 'pluginId' | 'perProfile' | 'values'>,
  manifest: PluginManifest | undefined,
  values: ConnectionValues | undefined,
): string {
  const fields = manifest ? resolveValues(manifest, connection, values).fields : (values?.fields ?? {});
  return signInOf(connection.pluginId, manifest, fields);
}

const contextOf = (key: string, field: string) => `sc/sealed/${VERSION}|${key}|${field}`;

/**
 * A password sealed for the household's other devices, bound to the change it
 * travels in (`key`, as `syncKey` names it), its field, and the sign-in it was
 * saved for. `undefined` when it would be too long to travel.
 */
export async function sealPassword(
  crypto: PluginCrypto,
  vault: Vault,
  key: string,
  field: string,
  password: string,
  signIn: string,
): Promise<string | undefined> {
  const sealed = await crypto.seal(vault.key, encodeUtf8(JSON.stringify({ v: password, s: signIn })), contextOf(key, field));
  const value = `${VERSION}.${vault.kid}.${encodeBase64Url(sealed)}`;
  return value.length <= MAX_SEALED ? value : undefined;
}

/** The password inside a sealed value, and the sign-in it was saved for — or nothing, for a value this device cannot open. */
export async function openPassword(
  crypto: PluginCrypto,
  vault: Vault,
  key: string,
  field: string,
  value: string,
): Promise<{ readonly password: string; readonly signIn: string } | undefined> {
  const [version, kid, body, ...rest] = value.split('.');
  if (version !== VERSION || kid !== vault.kid || body === undefined || rest.length > 0) return undefined;
  const bytes = decodeBase64Url(body);
  const opened = bytes && (await crypto.open(vault.key, bytes, contextOf(key, field)));
  const text = opened && decodeUtf8(opened);
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { v, s } = parsed as Readonly<Record<string, unknown>>;
    return typeof v === 'string' && typeof s === 'string' ? { password: v, signIn: s } : undefined;
  } catch {
    return undefined;
  }
}
