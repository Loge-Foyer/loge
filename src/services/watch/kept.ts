import { identityHash, type ExternalIds, type UserId } from '@loge/api';

import type { Repositories, WatchProgress } from '../ports';

/** A kept row's id: its profile, and a hash of what was watched — the same on every device, so two never make two rows. */
export function keptRowId(userId: UserId, identity: string): string {
  return `${userId}/${identityHash(identity)}`;
}

/** Something kept under its title that turned out to have a catalogue id. */
export interface KeptMove {
  /** The identity it was kept under: `title:movie:matrix:1999`. */
  readonly from: string;
  /** The one it has now: `tmdb:movie:603`. */
  readonly to: string;
  readonly externalIds: ExternalIds;
}

/**
 * Rows kept under a title moved to the catalogue's id — a film, or a series
 * with its seasons and episodes — each merged into what is kept there already.
 * Journaled, the move and the removal both, so every device of the account
 * follows. Awaits nothing but `tx`. How many rows moved.
 */
export async function moveKept(tx: Repositories, userId: UserId, moves: readonly KeptMove[]): Promise<number> {
  if (moves.length === 0) return 0;
  let moved = 0;
  for (const row of await tx.watchProgress.list(userId)) {
    const move = moves.find(({ from }) => row.identity === from || row.identity.startsWith(`${from}/`));
    if (!move) continue;
    const identity = move.to + row.identity.slice(move.from.length);
    const id = keptRowId(userId, identity);
    // The ids are the film's or the series', never an episode's own.
    const ids = row.identity === move.from ? { ...row.externalIds, ...move.externalIds } : row.externalIds;
    const existing = await tx.watchProgress.get(id);
    const merged = combineKept(existing, { ...row, id, identity, ...(ids ? { externalIds: ids } : {}) });
    await tx.watchProgress.put({ ...merged, version: (existing?.version ?? 0) + 1 });
    await tx.watchProgress.remove(row.id);
    moved += 1;
  }
  return moved;
}

/**
 * Two rows found to be one thing — kept under a title, and under the
 * catalogue's id — as one. Sync's rules decide between two devices' versions
 * of one row; these are two rows, so: watched if either was, where it got to
 * from the one touched last, and the later round, so that nothing either
 * device knew of the old rows outranks the merge.
 */
export function combineKept(kept: WatchProgress | undefined, moved: WatchProgress): WatchProgress {
  if (!kept) return moved;
  const later = moved.updatedAt > kept.updatedAt ? moved : kept;
  const ids = { ...moved.externalIds, ...kept.externalIds };
  const { positionMs: _position, durationMs: _duration, item: _item, externalIds: _ids, ...base } = kept;
  return {
    ...base,
    round: Math.max(kept.round, moved.round),
    watched: kept.watched || moved.watched,
    ...(later.positionMs === undefined ? {} : { positionMs: later.positionMs }),
    ...(later.durationMs === undefined ? {} : { durationMs: later.durationMs }),
    ...(later.item === undefined ? {} : { item: later.item }),
    ...(Object.keys(ids).length === 0 ? {} : { externalIds: ids }),
    createdAt: moved.createdAt < kept.createdAt ? moved.createdAt : kept.createdAt,
    updatedAt: later.updatedAt,
  };
}
