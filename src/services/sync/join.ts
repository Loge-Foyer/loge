import {
  accountCarries,
  AppError,
  syncKey,
  type ConnectedUserStateSyncProvider,
  type Connection,
  type SyncCapability,
  type SyncChange,
  type SyncCursor,
  type SyncEntity,
  type UserId,
} from '@sc/api';

import type { JournalAnnouncement, JournalEntry, Repositories, UserPreferences } from '../ports';
import { removeProfileIn } from '../removal';
import { appliedOf, newEffects, planPins, understood, writeChange, type Applied, type SyncParts } from './apply';
import { fold } from './fold';
import { keyOfEntry, targetsAccount } from './wire';

/** The account as the whole of its log says it is, read before anything is decided. */
export interface AccountPreview {
  /** The log's last word on each entity, parents first. */
  readonly changes: readonly SyncChange[];
  /** Where the log ended. */
  readonly cursor: SyncCursor;
  /** The profiles the account holds. */
  readonly profiles: ReadonlySet<UserId>;
}

/** Reads the whole log from the start. An account that loses its place meanwhile is read again, once. */
export async function previewAccount(
  provider: ConnectedUserStateSyncProvider,
  carried: ReadonlySet<SyncCapability>,
  parts: Pick<SyncParts, 'log'>,
): Promise<AccountPreview> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const changes: SyncChange[] = [];
    let cursor: SyncCursor | undefined;
    let complete = false;
    for (;;) {
      const page = await provider.pull(cursor);
      if (page.kind !== 'changes') break;
      changes.push(...understood(page.changes, parts.log));
      cursor = page.cursor;
      if (!page.more) {
        complete = true;
        break;
      }
    }
    if (complete && cursor !== undefined) {
      const last = fold(changes, carried);
      const profiles = new Set<UserId>();
      for (const change of last) if (change.entity === 'profile' && change.operation === 'upsert') profiles.add(change.data.userId);
      return { changes: last, cursor, profiles };
    }
  }
  throw new AppError('PROVIDER_UNAVAILABLE', 'The account could not be read from the start.', { retry: 'backoff' });
}

/**
 * Why this device joins: signing in (or switching) — with the answer to
 * "profiles on both sides?" — the account having lost data, or the account
 * carrying more than it did.
 */
export type JoinReason = { readonly kind: 'sign-in'; readonly profiles: 'account' | 'both' } | { readonly kind: 'reset' } | { readonly kind: 'grow' };

const PROFILE_OWNED: ReadonlySet<SyncEntity> = new Set(['profile', 'pin', 'preferences']);

/**
 * Joins an account: settles what both sides hold, announces this device's
 * rows in the journal — which the normal push then uploads, protected while
 * in flight and acknowledged by their echoes — and records where in the
 * account's log this device now stands. One unjournaled transaction, so a
 * failed join leaves nothing half done. `inTransaction` runs first inside it:
 * a sign-in writes the account's connection there.
 *
 * Who wins where both sides hold something:
 * - "Use the account's profiles": the account, for profiles, PINs and
 *   preferences; this device's other profiles go.
 * - Otherwise at sign-in: the account, unless this device changed it since it
 *   last left an account. Something deleted here since then is not brought
 *   back, and its delete is announced.
 * - `reset` and `grow`: this device — the account lost data, or never had it.
 */
export async function joinAccount(
  parts: SyncParts,
  account: Connection,
  carried: ReadonlySet<SyncCapability>,
  preview: AccountPreview,
  reason: JoinReason,
  inTransaction?: (tx: Repositories) => Promise<void>,
): Promise<Applied> {
  const fresh = await planPins(parts, preview.changes);
  const effects = newEffects();
  const signIn = reason.kind === 'sign-in';
  const accountsProfiles = reason.kind === 'sign-in' && reason.profiles === 'account';
  const alive = new Set(preview.changes.filter((change) => change.operation === 'upsert').map(syncKey));

  try {
    await parts.db.unjournaled(async (tx) => {
      await inTransaction?.(tx);
      const settings = await tx.deviceSettings.get();
      const state = await tx.syncState.get(account.id);
      const since = signIn ? (settings.leftAccountAt ?? 0) : (state?.checkpoint ?? 0);
      // What this device did since: the last entry per entity says what it did last.
      const lastHere = new Map<string, JournalEntry>();
      for (const entry of await tx.journal.entries(since)) lastHere.set(keyOfEntry(entry), entry);
      const headBefore = await tx.journal.head();

      if (accountsProfiles) {
        for (const user of await tx.users.list()) {
          if (preview.profiles.has(user.id)) continue;
          await removeProfileIn(tx, user.id, { allowLast: true });
          effects.removedProfiles.add(user.id);
          effects.changed = true;
        }
      }

      const fromAccount = new Set<string>();
      for (const change of preview.changes) {
        if (targetsAccount(change, account.id)) continue;
        const key = syncKey(change);
        const here = await holds(tx, change);
        const take =
          accountsProfiles && PROFILE_OWNED.has(change.entity)
            ? true
            : signIn
              ? here
                ? !lastHere.has(key)
                : lastHere.get(key)?.operation !== 'delete'
              : !here && lastHere.get(key)?.operation !== 'delete';
        if (take && (await writeChange(tx, parts, account.id, change, fresh, effects))) fromAccount.add(key);
      }

      // The account's profiles win entirely: what it does not hold for them goes too.
      if (accountsProfiles) {
        for (const user of await tx.users.list()) {
          const preferences = (await tx.preferences.get(user.id)) as Readonly<Record<string, unknown>>;
          const dropped = Object.keys(preferences).filter((key) => !alive.has(`preferences/${user.id}/${key}`));
          if (dropped.length > 0) {
            await tx.preferences.update(user.id, (current) => {
              const document: Record<string, unknown> = { ...current };
              for (const key of dropped) delete document[key];
              return document as UserPreferences;
            });
            effects.changed = true;
          }
          if (user.pinCredentialRef && !alive.has(`pin/${user.id}`)) {
            const { pinCredentialRef, ...without } = user;
            await tx.users.update(without);
            effects.stale.push(pinCredentialRef);
            effects.changed = true;
          }
        }
      }

      await tx.journal.announce(await announcement(tx, parts, account, carried, fromAccount));
      if (signIn) {
        // Deleted here since this device left an account, and still in this one: say so.
        const deletes: JournalAnnouncement[] = [];
        for (const [key, entry] of lastHere) {
          if (entry.operation !== 'delete' || !alive.has(key)) continue;
          if (accountsProfiles && PROFILE_OWNED.has(key.slice(0, key.indexOf('/')) as SyncEntity)) continue;
          deletes.push({ ...(entry.userId ? { userId: entry.userId } : {}), entity: entry.entity, entityId: entry.entityId, operation: 'delete', localVersion: 0 });
        }
        await tx.journal.announce(deletes);
      }

      const unused = [...fresh.values()].filter((ref) => !effects.adopted.has(ref));
      await tx.staleSecrets.add([...effects.stale, ...unused]);
      await tx.syncState.put({
        connectionId: account.id,
        cursor: preview.cursor,
        // At sign-in everything before now is in the announcement; after a reset what was pending still goes.
        checkpoint: signIn ? headBefore : (state?.checkpoint ?? headBefore),
        awaiting: {},
        carried: [...carried],
        ...(state?.lastSyncedAt === undefined ? {} : { lastSyncedAt: state.lastSyncedAt }),
      });
    });
  } catch (error) {
    for (const ref of fresh.values()) await parts.credentials.delete(ref).catch(() => undefined);
    throw error;
  }
  await parts.janitor.drain();
  return appliedOf(effects);
}

/** Whether this device holds what a change is about. A PIN belongs to its profile: "no PIN" is a value too. */
async function holds(tx: Repositories, change: SyncChange): Promise<boolean> {
  const of = change.operation === 'upsert' ? change.data : change.target;
  switch (change.entity) {
    case 'profile':
    case 'pin':
      return (await tx.users.get((of as { userId: UserId }).userId)) !== undefined;
    case 'preferences': {
      const { userId, key } = of as { userId: UserId; key: string };
      return ((await tx.preferences.get(userId)) as Readonly<Record<string, unknown>>)[key] !== undefined;
    }
    case 'connection':
      return (await tx.connections.get((of as { connectionId: Connection['id'] }).connectionId)) !== undefined;
    case 'profileValues': {
      const { connectionId, userId } = of as { connectionId: Connection['id']; userId: UserId };
      return (await tx.connections.profileValues(connectionId)).has(userId);
    }
  }
}

/** Every row of the kinds the account carries that the account's version did not just set, parents first. */
async function announcement(
  tx: Repositories,
  parts: SyncParts,
  account: Connection,
  carried: ReadonlySet<SyncCapability>,
  fromAccount: ReadonlySet<string>,
): Promise<readonly JournalAnnouncement[]> {
  const profiles: JournalAnnouncement[] = [];
  const pins: JournalAnnouncement[] = [];
  const connections: JournalAnnouncement[] = [];
  const preferences: JournalAnnouncement[] = [];
  const values: JournalAnnouncement[] = [];
  const mine = (key: string) => !fromAccount.has(key);

  for (const user of await tx.users.list()) {
    if (accountCarries(carried, 'profile') && mine(`profile/${user.id}`)) {
      profiles.push({ userId: user.id, entity: 'user', entityId: user.id, operation: 'upsert', localVersion: 0 });
    }
    if (accountCarries(carried, 'pin') && mine(`pin/${user.id}`)) {
      pins.push({ userId: user.id, entity: 'userPin', entityId: user.id, operation: 'upsert', localVersion: 0 });
    }
    if (accountCarries(carried, 'preferences')) {
      for (const key of Object.keys(await tx.preferences.get(user.id))) {
        if (mine(`preferences/${user.id}/${key}`)) {
          preferences.push({ userId: user.id, entity: 'preferences', entityId: `${user.id}/${key}`, operation: 'upsert', localVersion: 0 });
        }
      }
    }
  }
  for (const connection of await tx.connections.list()) {
    if (connection.id === account.id || connection.roles.sync === true || !parts.catalog.get(connection.pluginId)) continue;
    if (accountCarries(carried, 'connection') && mine(`connection/${connection.id}`)) {
      connections.push({ entity: 'connection', entityId: connection.id, operation: 'upsert', localVersion: 0 });
    }
    if (accountCarries(carried, 'profileValues')) {
      for (const userId of (await tx.connections.profileValues(connection.id)).keys()) {
        if (mine(`profileValues/${connection.id}/${userId}`)) {
          values.push({ userId, entity: 'connectionProfileValues', entityId: `${connection.id}/${userId}`, operation: 'upsert', localVersion: 0 });
        }
      }
    }
  }
  return [...profiles, ...pins, ...connections, ...preferences, ...values];
}
