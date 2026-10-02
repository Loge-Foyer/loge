import { connectionId, type GlobalMediaKey, type MediaItem } from '@loge/api';

const TYPES = ['movie', 'show', 'season', 'episode', 'channel', 'playlist'];

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isKey = (value: unknown): value is GlobalMediaKey =>
  isObject(value) && typeof value.connectionId === 'string' && value.connectionId !== '' && typeof value.externalId === 'string' && value.externalId !== '';

/**
 * A watch record's snapshot of what was played, read back as an item — or
 * nothing, where it is not one. It comes from the account, which comes from
 * whatever answers at its address, so it is checked before any screen draws
 * it: the shape every card reads, and nothing more is promised.
 */
export function snapshotOf(value: unknown): MediaItem | undefined {
  if (!isObject(value) || !TYPES.includes(String(value.type)) || !isKey(value.key) || typeof value.title !== 'string') return undefined;
  if (!isObject(value.ratings) || !Array.isArray(value.genres) || !isObject(value.images)) return undefined;
  if (!Object.values(value.images).every((ref) => typeof ref === 'string')) return undefined;
  if ((value.type === 'episode' || value.type === 'season') && !isKey(value.show)) return undefined;
  if (value.type === 'episode' && typeof value.showTitle !== 'string') return undefined;
  const key = value.key as GlobalMediaKey;
  return { ...(value as unknown as MediaItem), key: { connectionId: connectionId(key.connectionId), externalId: key.externalId } };
}

/** What a watch record keeps of an item: no watch state of its own, and no overview, which can run long. */
export function toSnapshot(item: MediaItem): MediaItem {
  const { watch: _watch, overview: _overview, ...kept } = item;
  return kept;
}
