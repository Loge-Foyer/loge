import { stableJson } from '@/services/hash';

/** Equal as data, whatever order their keys were written in. */
export function sameData(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/** One top-level entry of a document stored key by key. */
export function field(document: object, key: string): unknown {
  return (document as Readonly<Record<string, unknown>>)[key];
}

/**
 * The top-level keys a change sets and the ones it removes, so a document
 * stored key by key — device settings, a profile's preferences — writes only
 * what changed.
 */
export function changedKeys(current: object, next: object): { readonly set: readonly string[]; readonly removed: readonly string[] } {
  const set: string[] = [];
  const removed: string[] = [];
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    const value = field(next, key);
    if (value === undefined) {
      if (field(current, key) !== undefined) removed.push(key);
    } else if (!sameData(field(current, key), value)) {
      set.push(key);
    }
  }
  return { set, removed };
}

/** A document read back key by key. Its shape is whatever this app wrote. */
export function documentOf<T>(entries: readonly (readonly [string, unknown])[], base: object = {}): T {
  return { ...base, ...Object.fromEntries(entries) } as T;
}
