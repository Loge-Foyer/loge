import {
  accountCarries,
  credentialsRef as toCredentialsRef,
  isSyncChange,
  syncKey,
  type Connection,
  type ConnectionId,
  type ConnectionValues,
  type Credentials,
  type CredentialsRef,
  type PluginCrypto,
  type PluginId,
  type SyncCapability,
  type SyncChange,
  type SyncCursor,
  type UserId,
} from '@sc/api';

import { stableJson } from '../hash';
import type { PluginCatalog } from '../plugin-catalog';
import type { IdGenerator, Logger, Repositories, SecureCredentialStore, SyncDatabase, UserPreferences } from '../ports';
import { removeConnectionIn, removeProfileIn } from '../removal';
import type { SecretJanitor } from '../secrets';
import { sessionRef } from '../sessions';
import { openPassword, profileSignInOf, signInOf, type VaultSource } from './sealed';
import { keyOfEntry, mergeConnection, mergeProfile, mergeProfileValues, passwordsOf, targetsAccount, type PlannedPasswords } from './wire';

/** What the engine works with. */
export interface SyncParts {
  readonly db: SyncDatabase;
  readonly credentials: SecureCredentialStore;
  readonly catalog: PluginCatalog;
  readonly ids: IdGenerator;
  readonly janitor: SecretJanitor;
  readonly crypto: PluginCrypto;
  readonly log: Logger;
}

/**
 * A row's own passwords with the ones it lists but lacks filled in from a
 * seal — taken even when the change that brought them is not.
 */
export interface PlannedFill extends PlannedPasswords {
  /** The ref the row pointed at when this was planned: taken only while it still does. */
  readonly over: CredentialsRef | undefined;
}

/**
 * Secrets written under fresh refs before a transaction, keyed by the change
 * that brought them — the change itself, never its id, which only the account
 * vouches for.
 */
export interface Planned {
  readonly pins: ReadonlyMap<SyncChange, CredentialsRef>;
  readonly passwords: ReadonlyMap<SyncChange, PlannedPasswords>;
  readonly fills: ReadonlyMap<SyncChange, PlannedFill>;
}

function refsOf(planned: Planned): readonly CredentialsRef[] {
  return [
    ...planned.pins.values(),
    ...[...planned.passwords.values(), ...planned.fills.values()].map((passwords) => passwords.ref),
  ];
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

/**
 * Only what the contract allows arrives, and each id once; the rest is left
 * out, and said so — never with its values.
 */
export function understood(changes: readonly SyncChange[], log: Logger): readonly SyncChange[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    if (!isSyncChange(change)) {
      log.warn('sync', 'A change from the account was not understood, and was left out');
      return false;
    }
    if (seen.has(change.id)) {
      log.warn('sync', 'A change id came twice from the account; the second was left out');
      return false;
    }
    seen.add(change.id);
    return true;
  });
}

/**
 * Every secret `changes` bring, written under fresh refs before any
 * transaction — the credential store is no part of one. Whatever a
 * transaction does not adopt, it queues for deletion.
 */
export async function planSecrets(parts: SyncParts, changes: readonly SyncChange[], account: ConnectionId, vault: VaultSource | undefined): Promise<Planned> {
  const pins = await planPins(parts, changes);
  try {
    return { pins, ...(await planPasswords(parts, changes, account, vault)) };
  } catch (error) {
    for (const ref of pins.values()) await parts.credentials.delete(ref).catch(() => undefined);
    throw error;
  }
}

/** Deletes what a plan wrote, when nothing will ever point at it. */
export async function discardPlanned(parts: SyncParts, planned: Planned): Promise<void> {
  for (const ref of refsOf(planned)) await parts.credentials.delete(ref).catch(() => undefined);
}

/** The refs a transaction did not take, for it to queue. */
export function unusedOf(planned: Planned, effects: Effects): readonly CredentialsRef[] {
  return refsOf(planned).filter((ref) => !effects.adopted.has(ref));
}

/**
 * A fresh ref for every PIN change, but the first to a profile in these
 * changes when it is the PIN held already. The transaction adopts a change's
 * ref when it has one, and otherwise keeps the current one — which then can
 * only be the one held already: `[1111, 0000]` over a stored `0000` ends on
 * `0000`, as the log says.
 */
async function planPins(parts: SyncParts, changes: readonly SyncChange[]): Promise<ReadonlyMap<SyncChange, CredentialsRef>> {
  const fresh = new Map<SyncChange, CredentialsRef>();
  const seen = new Set<UserId>();
  try {
    for (const change of changes) {
      if (change.entity !== 'pin' || change.operation !== 'upsert') continue;
      const first = !seen.has(change.data.userId);
      seen.add(change.data.userId);
      if (change.data.pin === null) continue;
      if (first) {
        const user = await parts.db.users.get(change.data.userId);
        const current = user?.pinCredentialRef ? (await parts.credentials.read(user.pinCredentialRef).catch(() => undefined))?.pin : undefined;
        if (current === change.data.pin) continue;
      }
      const ref = toCredentialsRef(parts.ids.next());
      await parts.credentials.write(ref, { pin: change.data.pin });
      fresh.set(change, ref);
    }
  } catch (error) {
    for (const ref of fresh.values()) await parts.credentials.delete(ref).catch(() => undefined);
    throw error;
  }
  return fresh;
}

const sealedOf = (change: SyncChange) =>
  (change.entity === 'connection' || change.entity === 'profileValues') && change.operation === 'upsert' ? change.data.sealed : undefined;

/** A row as this device stores it, where it signs in, and its saved passwords — `undefined` when they cannot be read. */
interface Stored {
  readonly values: ConnectionValues;
  readonly signIn: string;
  readonly credentials: Credentials | undefined;
}

/**
 * The passwords sealed into `changes`, opened and written under fresh refs.
 * What a change brings is judged against its connection as the log stands at
 * that change — the page's own upserts and deletes folded over this device's
 * rows — and kept only if sealed for that sign-in. A scope's first change in
 * the page that holds what this device holds already gets no ref, as a PIN's.
 *
 * A fill is planned beside it for a row that lists a password its store
 * lacks: the row's own passwords, and the missing ones from a seal made for
 * where that row signs in.
 */
async function planPasswords(
  parts: SyncParts,
  changes: readonly SyncChange[],
  account: ConnectionId,
  source: VaultSource | undefined,
): Promise<Pick<Planned, 'passwords' | 'fills'>> {
  const passwords = new Map<SyncChange, PlannedPasswords>();
  const fills = new Map<SyncChange, PlannedFill>();
  if (!source || !changes.some((change) => sealedOf(change) !== undefined)) return { passwords, fills };
  // Asked only now, when something sealed arrived. If the account cannot give it, the page waits: applied without, the seals would be passed for good.
  const vault = await source();
  const manifestOf = (id: PluginId) => parts.catalog.get(id);

  const folded = new Map<ConnectionId, Connection | null>();
  const connectionAt = async (id: ConnectionId) => (folded.has(id) ? (folded.get(id) ?? undefined) : parts.db.connections.get(id));
  // Scopes an earlier change in the page wrote or took away: what is stored no longer says what they hold at this point.
  const touched = new Set<string>();
  // Connections whose sign-in the page moved, and rows its deletes remove — those always apply.
  const moved = new Set<ConnectionId>();
  const removedConnections = new Set<ConnectionId>();
  const removedUsers = new Set<UserId>();
  const filled = new Set<string>();

  const credentialsOf = async (values: ConnectionValues): Promise<Credentials | undefined> => {
    if (!values.credentialsRef) return {};
    try {
      return (await parts.credentials.read(values.credentialsRef)) ?? {};
    } catch {
      return undefined;
    }
  };
  const write = async (credentials: Credentials) => {
    const ref = toCredentialsRef(parts.ids.next());
    await parts.credentials.write(ref, credentials);
    return ref;
  };

  const plan = async (change: SyncChange, scope: string, keys: readonly string[], signIn: string, stored: Stored | undefined, untouched: boolean) => {
    const sealed = sealedOf(change);
    if (!sealed) return;
    const opened = new Map<string, { readonly password: string; readonly signIn: string }>();
    for (const field of keys) {
      const value = sealed[field];
      if (value === undefined) continue;
      const password = await openPassword(parts.crypto, vault, scope, field, value);
      if (password) opened.set(field, password);
      else parts.log.warn('sync', 'A sealed password did not open, and was left out');
    }

    const taken: Record<string, string> = {};
    for (const [field, password] of opened) if (password.signIn === signIn) taken[field] = password.password;
    if (Object.keys(taken).length > 0) {
      // What this device holds counts only where nothing earlier in the page could have changed it, and for the same sign-in.
      const own = untouched && stored && stored.signIn === signIn ? stored.credentials : undefined;
      const next = pick({ ...own, ...taken }, keys);
      const holdsAlready =
        own !== undefined &&
        stored?.values.credentialsRef !== undefined &&
        Object.keys(next).every((key) => stored.values.secretKeys?.includes(key)) &&
        stableJson(pick(own, keys)) === stableJson(next);
      if (!holdsAlready) passwords.set(change, { ref: await write(next), signIn });
    }

    const missing: Record<string, string> = {};
    const saved = stored?.credentials;
    if (stored && saved && !filled.has(scope)) {
      for (const key of stored.values.secretKeys ?? []) {
        const password = opened.get(key);
        if (saved[key] === undefined && password?.signIn === stored.signIn) missing[key] = password.password;
      }
      if (Object.keys(missing).length > 0) {
        fills.set(change, { ref: await write({ ...saved, ...missing }), signIn: stored.signIn, over: stored.values.credentialsRef });
        filled.add(scope);
      }
    }
    if ([...opened].some(([field, password]) => password.signIn !== signIn && missing[field] === undefined)) {
      parts.log.warn('sync', 'A sealed password was for another sign-in, and was left out');
    }
  };

  try {
    for (const change of changes) {
      if (targetsAccount(change, account)) continue;
      const scope = syncKey(change);
      if (change.entity === 'profile') {
        if (change.operation === 'delete') removedUsers.add(change.target.userId);
      } else if (change.entity === 'connection') {
        if (change.operation === 'delete') {
          folded.set(change.target.connectionId, null);
          removedConnections.add(change.target.connectionId);
        } else {
          const { connectionId } = change.data;
          const before = await connectionAt(connectionId);
          const row = mergeConnection(before, change.data, manifestOf).row;
          const signIn = signInOf(row.pluginId, manifestOf(row.pluginId), row.values.fields);
          if (before && signInOf(before.pluginId, manifestOf(before.pluginId), before.values.fields) !== signIn) moved.add(connectionId);
          folded.set(connectionId, row);
          const here = removedConnections.has(connectionId) ? undefined : await parts.db.connections.get(connectionId);
          const stored = here && {
            values: here.values,
            signIn: signInOf(here.pluginId, manifestOf(here.pluginId), here.values.fields),
            credentials: await credentialsOf(here.values),
          };
          await plan(change, scope, passwordsOf(manifestOf(row.pluginId), change.data.secretKeys), signIn, stored, !touched.has(scope));
        }
      } else if (change.entity === 'profileValues' && change.operation === 'upsert' && !change.data.off) {
        const { connectionId, userId } = change.data;
        // A connection not known at this point in the log has no sign-in to judge against: nothing is planned.
        const connection = await connectionAt(connectionId);
        if (connection) {
          const manifest = manifestOf(connection.pluginId);
          const signIn = profileSignInOf(connection, manifest, { fields: change.data.fields, settings: change.data.settings });
          const gone = removedConnections.has(connectionId) || removedUsers.has(userId);
          const here = gone ? undefined : await parts.db.connections.get(connectionId);
          const values = here && (await parts.db.connections.profileValues(connectionId)).get(userId);
          const stored = here &&
            values && {
              values,
              signIn: profileSignInOf(here, manifestOf(here.pluginId), values),
              credentials: await credentialsOf(values),
            };
          await plan(change, scope, passwordsOf(manifest, change.data.secretKeys), signIn, stored, !touched.has(scope) && !moved.has(connectionId));
        }
      }
      touched.add(scope);
    }
  } catch (error) {
    for (const planned of [...passwords.values(), ...fills.values()]) await parts.credentials.delete(planned.ref).catch(() => undefined);
    throw error;
  }
  return { passwords, fills };
}

function pick(credentials: Credentials, keys: readonly string[]): Credentials {
  const picked: Record<string, string> = {};
  for (const key of keys) {
    const value = credentials[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
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
  planned: Planned,
  effects: Effects,
): Promise<boolean> {
  const manifestOf = (id: Connection['pluginId']) => parts.catalog.get(id);
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
      const ref = planned.pins.get(change);
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
      const merged = mergeConnection(local, data, manifestOf, planned.passwords.get(change));
      if (merged.adopted) effects.adopted.add(merged.adopted);
      if (local && merged.changed) await dropMovedPasswords(tx, local, merged.row, manifestOf, effects);
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
      const merged = mergeProfileValues(local, change.data, connection, parts.catalog.get(connection.pluginId), planned.passwords.get(change));
      if (merged.adopted) effects.adopted.add(merged.adopted);
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

/**
 * A connection that now signs in somewhere else — another address or plugin —
 * takes its profiles' passwords off them: they were saved for where it signed
 * in before. Their rows still list the names, so each profile asks. One of the
 * two exceptions to rule 1: it writes even a row this device has changed.
 */
async function dropMovedPasswords(
  tx: Repositories,
  before: Connection,
  after: Connection,
  manifestOf: (id: Connection['pluginId']) => ReturnType<PluginCatalog['get']>,
  effects: Effects,
): Promise<void> {
  for (const [userId, values] of await tx.connections.profileValues(before.id)) {
    if (!values.credentialsRef) continue;
    if (profileSignInOf(before, manifestOf(before.pluginId), values) === profileSignInOf(after, manifestOf(after.pluginId), values)) continue;
    const { credentialsRef, ...without } = values;
    await tx.connections.putProfileValues(before.id, userId, without);
    effects.stale.push(credentialsRef);
    effects.connections.add(before.id);
    effects.changed = true;
  }
}

/**
 * A change this device does not take may still carry a password it lacks, for
 * the very sign-in its own row has: that much it takes, and nothing else — a
 * missing password cannot be newer than anything. Its next push carries it,
 * sealed. The other exception to rule 1.
 */
export async function fillIn(tx: Repositories, parts: SyncParts, change: SyncChange, planned: Planned, effects: Effects): Promise<void> {
  const fill = planned.fills.get(change);
  if (!fill || change.operation !== 'upsert') return;
  const take = (connectionId: ConnectionId) => {
    if (fill.over) effects.stale.push(fill.over);
    effects.adopted.add(fill.ref);
    effects.connections.add(connectionId);
    effects.changed = true;
  };
  if (change.entity === 'connection') {
    const local = await tx.connections.get(change.data.connectionId);
    if (!local || local.values.credentialsRef !== fill.over) return;
    if (signInOf(local.pluginId, parts.catalog.get(local.pluginId), local.values.fields) !== fill.signIn) return;
    await tx.connections.update({ ...local, values: { ...local.values, credentialsRef: fill.ref } });
    take(local.id);
  } else if (change.entity === 'profileValues') {
    const connection = await tx.connections.get(change.data.connectionId);
    const local = connection && (await tx.connections.profileValues(connection.id)).get(change.data.userId);
    if (!connection || !local || local.credentialsRef !== fill.over) return;
    if (profileSignInOf(connection, parts.catalog.get(connection.pluginId), local) !== fill.signIn) return;
    await tx.connections.putProfileValues(connection.id, change.data.userId, { ...local, credentialsRef: fill.ref });
    take(connection.id);
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
  vault?: VaultSource,
): Promise<Applied | 'moved'> {
  const changes = understood(pulled, parts.log).filter((change) => accountCarries(carried, change.entity));
  const planned = await planSecrets(parts, changes, account.id, vault);
  const effects = newEffects();
  let outcome: 'applied' | 'moved';
  try {
    outcome = await parts.db.unjournaled(async (tx) => {
      const state = await tx.syncState.get(account.id);
      if (!state || state.cursor !== from) {
        await tx.staleSecrets.add(refsOf(planned));
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
        if (ours && !alwaysApplied(change)) {
          await fillIn(tx, parts, change, planned, effects);
          continue;
        }
        await writeChange(tx, parts, account.id, change, planned, effects);
      }

      await tx.staleSecrets.add([...effects.stale, ...unusedOf(planned, effects)]);
      await tx.syncState.put({ ...state, cursor: to, checkpoint, awaiting });
      return 'applied';
    });
  } catch (error) {
    await discardPlanned(parts, planned);
    throw error;
  }
  await parts.janitor.drain();
  return outcome === 'moved' ? 'moved' : appliedOf(effects);
}
