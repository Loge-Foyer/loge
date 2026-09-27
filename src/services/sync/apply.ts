import {
  accountCarries,
  credentialsRef as toCredentialsRef,
  isSyncChange,
  syncKey,
  type Connection,
  type ConnectionId,
  type CredentialsRef,
  type SyncCapability,
  type SyncChange,
  type SyncCursor,
  type UserId,
} from '@sc/api';

import type { PluginCatalog } from '../plugin-catalog';
import type { IdGenerator, Logger, Repositories, SecureCredentialStore, SyncDatabase, UserPreferences } from '../ports';
import { removeConnectionIn, removeProfileIn } from '../removal';
import type { SecretJanitor } from '../secrets';
import { sessionRef } from '../sessions';
import { keyOfEntry, mergeConnection, mergeProfile, mergeProfileValues, targetsAccount } from './wire';

/** What the engine works with. */
export interface SyncParts {
  readonly db: SyncDatabase;
  readonly credentials: SecureCredentialStore;
  readonly catalog: PluginCatalog;
  readonly ids: IdGenerator;
  readonly janitor: SecretJanitor;
  readonly log: Logger;
}

/** What applying changed — for whatever holds on to something that depends on it. */
export interface Applied {
  readonly connections: ReadonlySet<ConnectionId>;
  readonly removedProfiles: ReadonlySet<UserId>;
  readonly arrivedProfiles: ReadonlySet<UserId>;
  /** Anything at all: profiles, PINs, preferences, connections. */
  readonly changed: boolean;
}

export interface Effects {
  readonly connections: Set<ConnectionId>;
  readonly removedProfiles: Set<UserId>;
  readonly arrivedProfiles: Set<UserId>;
  readonly stale: CredentialsRef[];
  readonly adopted: Set<CredentialsRef>;
  changed: boolean;
}

export function newEffects(): Effects {
  return { connections: new Set(), removedProfiles: new Set(), arrivedProfiles: new Set(), stale: [], adopted: new Set(), changed: false };
}

export function appliedOf(effects: Effects): Applied {
  return {
    connections: effects.connections,
    removedProfiles: effects.removedProfiles,
    arrivedProfiles: effects.arrivedProfiles,
    changed: effects.changed,
  };
}

/** Only what the contract allows arrives; the rest is left out, and said so — never with its values. */
export function understood(changes: readonly SyncChange[], log: Logger): readonly SyncChange[] {
  return changes.filter((change) => {
    if (isSyncChange(change)) return true;
    log.warn('sync', 'A change from the account was not understood, and was left out');
    return false;
  });
}

/**
 * The PINs among `changes` that differ from this device's, written under
 * fresh refs before any transaction — the credential store is no part of one.
 * Whatever a transaction does not adopt, it queues for deletion.
 */
export async function planPins(parts: SyncParts, changes: readonly SyncChange[]): Promise<ReadonlyMap<string, CredentialsRef>> {
  const fresh = new Map<string, CredentialsRef>();
  for (const change of changes) {
    if (change.entity !== 'pin' || change.operation !== 'upsert' || change.data.pin === null) continue;
    const user = await parts.db.users.get(change.data.userId);
    const current = user?.pinCredentialRef ? (await parts.credentials.read(user.pinCredentialRef).catch(() => undefined))?.pin : undefined;
    if (current === change.data.pin) continue;
    const ref = toCredentialsRef(parts.ids.next());
    await parts.credentials.write(ref, { pin: change.data.pin });
    fresh.set(change.id, ref);
  }
  return fresh;
}

/**
 * Writes one change as it arrived, inside `tx`. Which changes to write is the
 * caller's decision. Nothing here fails on the data: every write is checked
 * first, because on IndexedDB a failed request aborts the whole transaction,
 * caught or not, and the page would never move on. `false` when there was
 * nothing it could be written to — a child whose parent is gone.
 */
export async function writeChange(
  tx: Repositories,
  parts: SyncParts,
  account: ConnectionId,
  change: SyncChange,
  fresh: ReadonlyMap<string, CredentialsRef>,
  effects: Effects,
): Promise<boolean> {
  if (targetsAccount(change, account)) return false;
  switch (change.entity) {
    case 'profile': {
      if (change.operation === 'delete') {
        // The account removed it; even a device's last profile goes, and the device starts again.
        if (await removeProfileIn(tx, change.target.userId, { allowLast: true })) {
          effects.removedProfiles.add(change.target.userId);
          effects.changed = true;
        }
        return true;
      }
      const local = await tx.users.get(change.data.userId);
      const row = mergeProfile(local, change.data);
      if (!local) {
        await tx.users.insert(row);
        effects.arrivedProfiles.add(row.id);
        effects.changed = true;
      } else if (local.name !== row.name) {
        await tx.users.update(row);
        effects.changed = true;
      }
      return true;
    }
    case 'pin': {
      const user = await tx.users.get(change.data.userId);
      if (!user) return false;
      if (change.data.pin === null) {
        if (!user.pinCredentialRef) return true;
        const { pinCredentialRef, ...without } = user;
        await tx.users.update(without);
        effects.stale.push(pinCredentialRef);
        effects.changed = true;
        return true;
      }
      const ref = fresh.get(change.id);
      // No fresh ref: this device's PIN is that one already.
      if (!ref) return true;
      await tx.users.update({ ...user, pinCredentialRef: ref });
      effects.adopted.add(ref);
      if (user.pinCredentialRef) effects.stale.push(user.pinCredentialRef);
      effects.changed = true;
      return true;
    }
    case 'preferences': {
      const target = change.operation === 'upsert' ? change.data : change.target;
      if (!(await tx.users.get(target.userId))) return false;
      await tx.preferences.update(target.userId, (current) => {
        const document: Record<string, unknown> = { ...current };
        if (change.operation === 'upsert') document[change.data.key] = change.data.value;
        else delete document[change.target.key];
        return document as UserPreferences;
      });
      effects.changed = true;
      return true;
    }
    case 'connection': {
      if (change.operation === 'delete') {
        if (await removeConnectionIn(tx, change.target.connectionId)) {
          effects.connections.add(change.target.connectionId);
          effects.changed = true;
        }
        return true;
      }
      const { data } = change;
      const local = await tx.connections.get(data.connectionId);
      const merged = mergeConnection(local, data, parts.catalog.get(data.pluginId));
      if (!local) {
        await tx.connections.insert(merged.row);
        // A connection new to this device brings its plugin along — this build's plugins only.
        if (parts.catalog.get(data.pluginId)) {
          await tx.deviceSettings.update((current) =>
            current.plugins[data.pluginId]?.enabled ? current : { ...current, plugins: { ...current.plugins, [data.pluginId]: { enabled: true } } },
          );
        }
      } else if (merged.changed) {
        await tx.connections.update(merged.row);
      }
      effects.stale.push(...merged.stale);
      if (merged.changed) {
        // What the source answered under other values may not hold now.
        await tx.mediaCache.purge(data.connectionId);
        effects.connections.add(data.connectionId);
        effects.changed = true;
      }
      return true;
    }
    case 'profileValues': {
      const target = change.operation === 'upsert' ? change.data : change.target;
      const connection = await tx.connections.get(target.connectionId);
      if (!connection || !(await tx.users.get(target.userId))) return false;
      const local = (await tx.connections.profileValues(target.connectionId)).get(target.userId);
      if (change.operation === 'delete') {
        if (!local) return true;
        await tx.connections.deleteProfileValues(target.connectionId, target.userId);
        effects.stale.push(...(local.credentialsRef ? [local.credentialsRef] : []), sessionRef(target.connectionId, target.userId));
        await tx.mediaCache.purge(target.connectionId, target.userId);
        effects.connections.add(target.connectionId);
        effects.changed = true;
        return true;
      }
      const merged = mergeProfileValues(local, change.data, parts.catalog.get(connection.pluginId));
      effects.stale.push(...merged.stale);
      if (merged.changed) {
        await tx.connections.putProfileValues(target.connectionId, target.userId, merged.row);
        await tx.mediaCache.purge(target.connectionId, target.userId);
        effects.connections.add(target.connectionId);
        effects.changed = true;
      }
      return true;
    }
  }
}

/** Deletes of these win even over this device's own change: the cascade takes the children with them. */
function alwaysApplied(change: SyncChange): boolean {
  return change.operation === 'delete' && (change.entity === 'profile' || change.entity === 'connection');
}

/**
 * Applies pulled changes in the account's order, together with the cursor
 * after them — as long as the cursor they were pulled from is still the one
 * stored; otherwise another run got there first, and this answers `moved`.
 *
 * A change is skipped while this device has a change to the same entity the
 * account has not returned yet — still pending, or accepted and on its way
 * back: this device's is later in the log, and wins. A change carrying the id
 * of a pending entry is that entry's acknowledgement, whose answer was lost.
 */
export async function applyPage(
  parts: SyncParts,
  account: Connection,
  carried: ReadonlySet<SyncCapability>,
  from: SyncCursor | undefined,
  pulled: readonly SyncChange[],
  to: SyncCursor,
): Promise<Applied | 'moved'> {
  const changes = understood(pulled, parts.log).filter((change) => accountCarries(carried, change.entity));
  const fresh = await planPins(parts, changes);
  const effects = newEffects();
  let outcome: 'applied' | 'moved';
  try {
    outcome = await parts.db.unjournaled(async (tx) => {
      const state = await tx.syncState.get(account.id);
      if (!state || state.cursor !== from) {
        await tx.staleSecrets.add([...fresh.values()]);
        return 'moved';
      }
      const entries = await tx.journal.entries(state.checkpoint);
      const seqOf = new Map(entries.flatMap((entry) => (entry.changeId ? [[entry.changeId, entry.seq] as const] : [])));
      let checkpoint = state.checkpoint;
      const pendingKeys = () => new Set(entries.filter((entry) => entry.seq > checkpoint).map(keyOfEntry));
      let pending = pendingKeys();
      const awaiting: Record<string, string> = { ...state.awaiting };

      for (const change of changes) {
        if (targetsAccount(change, account.id)) continue;
        const key = syncKey(change);
        const acknowledged = seqOf.get(change.id);
        if (acknowledged !== undefined && acknowledged > checkpoint) {
          // Pushes go out in order and are accepted as a prefix, so everything before it made it too.
          checkpoint = acknowledged;
          pending = pendingKeys();
        }
        if (awaiting[key] === change.id) delete awaiting[key];
        const ours = pending.has(key) || awaiting[key] !== undefined;
        if (ours && !alwaysApplied(change)) continue;
        await writeChange(tx, parts, account.id, change, fresh, effects);
      }

      const unused = [...fresh.values()].filter((ref) => !effects.adopted.has(ref));
      await tx.staleSecrets.add([...effects.stale, ...unused]);
      await tx.syncState.put({ ...state, cursor: to, checkpoint, awaiting });
      return 'applied';
    });
  } catch (error) {
    for (const ref of fresh.values()) await parts.credentials.delete(ref).catch(() => undefined);
    throw error;
  }
  await parts.janitor.drain();
  return outcome === 'moved' ? 'moved' : appliedOf(effects);
}
