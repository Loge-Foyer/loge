import { isLibrarySelection } from './fields';

// Shape checks for untrusted data — what an account or a server sends back —
// shared by the contracts that accept it. Internal: not exported from the index.

const KEY = /^[a-z][A-Za-z0-9]*$/;
const MAX_ID = 128;
const MAX_TEXT = 200;
const MAX_DEPTH = 32;

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ids join into keys with `/`, so one containing it could pass for another. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_ID && !value.includes('/');
}

export function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT;
}

export function isKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID && KEY.test(value);
}

export function isKeyList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_ID && value.every(isKey);
}

export function isFieldValues(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, entry]) => isKey(key) && (typeof entry === 'string' || typeof entry === 'boolean' || isLibrarySelection(entry)),
  );
}

export function isJson(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJson(entry, depth + 1));
  if (isRecord(value)) return Object.values(value).every((entry) => isJson(entry, depth + 1));
  return false;
}
