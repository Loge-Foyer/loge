/**
 * FNV-1a, twice with different seeds for 64 bits of hex. For identifiers that
 * must be stable and opaque, not secret — nothing here needs cryptography.
 */
export function stableHash(text: string): string {
  return fnv1a32(text, 0x811c9dc5) + fnv1a32(text, 0x01000193);
}

function fnv1a32(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** JSON with object keys sorted, so equal values always give equal text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : entry,
  );
}
