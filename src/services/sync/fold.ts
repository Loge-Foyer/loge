import { accountCarries, syncKey, type SyncCapability, type SyncChange, type SyncEntity } from '@sc/api';

// Parents before their children, so a profile exists before its PIN and preferences arrive.
const PARENTS_FIRST: Readonly<Record<SyncEntity, number>> = { profile: 0, connection: 1, pin: 2, preferences: 3, profileValues: 4 };

/** The log's last word on each entity the account carries, parents first. */
export function fold(changes: readonly SyncChange[], carried: ReadonlySet<SyncCapability>): readonly SyncChange[] {
  const last = new Map<string, SyncChange>();
  for (const change of changes) {
    if (accountCarries(carried, change.entity)) last.set(syncKey(change), change);
  }
  return [...last.values()].sort((a, b) => PARENTS_FIRST[a.entity] - PARENTS_FIRST[b.entity]);
}
