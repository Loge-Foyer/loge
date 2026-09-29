import { decodeBase64Url, encodeBase64Url, isSyncChange, syncCursor, type KdfParams, type PullResult } from '@sc/api';

// Guards for everything the server answers: `unknown` goes in, and only what
// the contract allows comes out.

/** A key's parameters as they travel: the salt as base64url. */
export interface WireKdf {
  readonly algorithm: string;
  readonly iterations: number;
  readonly salt: string;
}

export function kdfToWire(params: KdfParams): WireKdf {
  return { algorithm: params.algorithm, iterations: params.iterations, salt: encodeBase64Url(params.salt) };
}

/** Parameters decoded, not yet judged: `isKdfParams` does that, before anything is derived. */
export function readKdf(value: unknown): { readonly algorithm: unknown; readonly iterations: unknown; readonly salt: Uint8Array } | undefined {
  if (!isRecord(value) || typeof value.salt !== 'string') return undefined;
  const salt = decodeBase64Url(value.salt);
  return salt && { algorithm: value.algorithm, iterations: value.iterations, salt };
}

export function readParams(body: unknown): ReturnType<typeof readKdf> {
  return isRecord(body) ? readKdf(body.kdf) : undefined;
}

/** What signing in or creating an account answers: this device's token, and the vault key as the server keeps it. */
export interface SignedIn {
  readonly token: string;
  readonly vault: string;
}

export function readSignedIn(body: unknown): SignedIn | undefined {
  if (!isRecord(body) || typeof body.token !== 'string' || body.token === '' || typeof body.vault !== 'string') return undefined;
  return { token: body.token, vault: body.vault };
}

/** The account's name as the server knows it. */
export function readStatus(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.account) || typeof body.account.name !== 'string') return undefined;
  return body.account.name;
}

/** A page of the log. A change the contract does not allow is left out — the server checks pushes the same way. */
export function readPage(body: unknown): PullResult | undefined {
  if (!isRecord(body)) return undefined;
  if (body.kind === 'reset' || body.kind === 'expired') return { kind: body.kind };
  if (body.kind !== 'changes' || !Array.isArray(body.changes) || typeof body.cursor !== 'string' || body.cursor === '') return undefined;
  if (typeof body.more !== 'boolean') return undefined;
  return { kind: 'changes', changes: body.changes.filter(isSyncChange), cursor: syncCursor(body.cursor), more: body.more };
}

export function readAccepted(body: unknown): readonly string[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.accepted) || !body.accepted.every((id) => typeof id === 'string')) return undefined;
  return body.accepted as readonly string[];
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
