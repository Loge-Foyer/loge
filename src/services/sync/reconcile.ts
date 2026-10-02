import {
  connectionId as toConnectionId,
  credentialsRef as toCredentialsRef,
  imageRef,
  isAccountRecord,
  userId as toUserId,
  type AccountRecord,
  type Connection,
  type Credentials,
  type CredentialsRef,
  type FieldValue,
  type FieldValues,
  type PluginManifest,
  type RecordData,
  type UserId,
} from '@sc/api';

import { stableJson } from '../hash';
import type { JournalAnnouncement, ProfileValues, Repositories, UserPreferences, WatchProgress } from '../ports';
import { removeConnectionIn, removeProfileIn } from '../removal';
import { accountWide } from '../scope';
import { sessionRef } from '../sessions';
import { snapshotOf } from '../watch/snapshot';
import type { Applied, SyncParts } from './parts';
import { announcementOf, identityOf, identityOfEntry } from './records';

type Live<K extends AccountRecord['kind']> = Extract<AccountRecord, { kind: K; deleted: false }>;

/** The account's records, understood, and the secrets they bring, written under fresh refs before any transaction. */
export interface Plan {
  readonly records: readonly AccountRecord[];
  readonly secrets: ReadonlyMap<string, CredentialsRef>;
}

/** What applying changed, and the refs it let go of and took. */
export interface Outcome extends Applied {
  readonly stale: readonly CredentialsRef[];
  readonly adopted: ReadonlySet<CredentialsRef>;
}

export interface ApplyOptions {
  /** What the server lets the account hold: a profile held back waits for room below it. */
  readonly maxProfiles: number;
  /** Rule 4. A replace writes the account onto a device emptied first: nothing there can be lost. */
  readonly restoreLost: boolean;
  /** Records the server refused as invalid: missing there for that reason, not lost. */
  readonly refused?: ReadonlySet<string>;
}

/**
 * Watch progress is the one entity resolved field by field (spec §10), on the
 * client — the server stores what it is sent and returns it. A later round —
 * someone chose "mark as unwatched" — wins whole. Within one round, watched
 * holds once either side says so, and where it got to is the last push's: a
 * deliberate rewind on one device must reach the others, which "the furthest
 * position" would undo. While this device's own change waits to go, its
 * position is the one that counts.
 */
export function mergeWatchProgress(local: WatchProgress, server: WatchProgress, localPending: boolean): WatchProgress {
  if (server.round !== local.round) return server.round > local.round ? server : local;
  const latest = localPending ? local : server;
  return {
    ...latest,
    watched: local.watched || server.watched,
    // Every catalogue either side knows it by.
    ...(local.externalIds || server.externalIds ? { externalIds: { ...server.externalIds, ...local.externalIds } } : {}),
    createdAt: local.createdAt < server.createdAt ? local.createdAt : server.createdAt,
  };
}

const sameProgress = (a: WatchProgress, b: WatchProgress) => stableJson({ ...a, version: 0 }) === stableJson({ ...b, version: 0 });

/**
 * Makes this device hold what the account holds — the server's collections
 * are the truth — by these rules and no other, never by a clock:
 *
 * 1. An entity with a change pending here is left alone: that change goes
 *    next, and wins.
 * 2. A deleted profile or connection is deleted here, always, pending or not:
 *    it never comes back, and everything of it goes too.
 * 3. Otherwise the server's version replaces this device's where they differ.
 * 4. A row here the server has no record of at all, and that is not pending,
 *    was lost by the server — restored from an old backup — so it is
 *    announced again, and the next push puts it back.
 *
 * Passwords and PINs go into the keychain under fresh refs first, outside any
 * transaction; then one unjournaled transaction applies everything — what
 * arrives from the account is not this device's change; then the refs nothing
 * points at any more are deleted.
 */
export async function reconcile(
  parts: SyncParts,
  snapshot: readonly AccountRecord[],
  options: Pick<ApplyOptions, 'maxProfiles' | 'refused'>,
): Promise<Applied> {
  const plan = await planRecords(parts, snapshot, { keepLocal: true });
  let outcome: Outcome;
  try {
    outcome = await parts.db.unjournaled(async (tx) => {
      const applied = await applyRecords(tx, parts, plan, { ...options, restoreLost: true });
      await tx.staleSecrets.add(unusedOf(plan, applied));
      return applied;
    });
  } catch (error) {
    await discardPlan(parts, plan);
    throw error;
  }
  await parts.janitor.drain();
  return outcome;
}

/**
 * The records understood, and every PIN and password they bring written under
 * a fresh ref — unless, with `keepLocal`, this device holds exactly that
 * already. A replace writes onto a device emptied first, so it keeps nothing.
 */
export async function planRecords(parts: SyncParts, snapshot: readonly AccountRecord[], options: { readonly keepLocal: boolean }): Promise<Plan> {
  const records = understood(snapshot, parts);
  const pending = options.keepLocal ? new Set((await parts.db.journal.entries((await parts.db.account.sync()).checkpoint)).map(identityOfEntry)) : new Set<string>();
  return { records, secrets: await planSecrets(parts, records, pending, options.keepLocal) };
}

/** Deletes what a plan wrote, when nothing will ever point at it. */
export async function discardPlan(parts: SyncParts, plan: Plan): Promise<void> {
  for (const ref of plan.secrets.values()) await parts.credentials.delete(ref).catch(() => undefined);
}

/** The refs to queue once applied: the ones let go of, and the planned ones nothing took. */
export function unusedOf(plan: Plan, outcome: Outcome): readonly CredentialsRef[] {
  return [...outcome.stale, ...[...plan.secrets.values()].filter((ref) => !outcome.adopted.has(ref))];
}

/**
 * The account's records written inside `tx`, by the rules above. Nothing here
 * may fail on the data — every write is checked first — because on IndexedDB
 * a failed request aborts the whole transaction, caught or not.
 */
export async function applyRecords(tx: Repositories, parts: SyncParts, plan: Plan, options: ApplyOptions): Promise<Outcome> {
  const { records } = plan;
  const planned = plan.secrets;
  const byIdentity = new Map(records.map((record) => [identityOf(record), record] as const));
  const effects = { connections: new Set<Connection['id']>(), removedProfiles: new Set<UserId>(), arrivedProfiles: new Set<UserId>(), changed: false };
  const stale: CredentialsRef[] = [];
  const adopted = new Set<CredentialsRef>();
  const manifestOf = (id: Connection['pluginId']) => parts.catalog.get(id);

  const state = await tx.account.sync();
  // Read here: a user can change something between the plan and the transaction.
  const pending = new Set((await tx.journal.entries(state.checkpoint)).map(identityOfEntry));
  const alwaysApplied = (record: AccountRecord) => record.deleted && (record.kind === 'profile' || record.kind === 'connection');
  const ofKind = <K extends AccountRecord['kind']>(kind: K) =>
    records.filter(
      (record): record is Extract<AccountRecord, { kind: K }> => record.kind === kind && (alwaysApplied(record) || !pending.has(identityOf(record))),
    );

  for (const record of ofKind('profile')) {
    const id = toUserId(record.key);
    if (record.deleted) {
      // Even a device's last profile goes: it then asks for a first one.
      if (await removeProfileIn(tx, id, { allowLast: true })) {
        effects.removedProfiles.add(id);
        effects.changed = true;
      }
      continue;
    }
    const local = await tx.users.get(id);
    if (!local) {
      await tx.users.insert({ id, name: record.data.name });
      effects.arrivedProfiles.add(id);
      effects.changed = true;
    } else if (local.name !== record.data.name) {
      await tx.users.update({ ...local, name: record.data.name });
      effects.changed = true;
    }
  }

  for (const record of ofKind('connection')) {
    const id = toConnectionId(record.key);
    if (record.deleted) {
      if (await removeConnectionIn(tx, id)) {
        effects.connections.add(id);
        effects.changed = true;
      }
      continue;
    }
    const local = await tx.connections.get(id);
    const row = connectionOf(record, manifestOf(record.data.pluginId), credentialsFor(planned, record, local?.values.credentialsRef, stale, adopted));
    if (!local) await tx.connections.insert(row);
    else if (stableJson(local) !== stableJson(row)) await tx.connections.update(row);
    else continue;
    // What the source answered under other values may not hold now.
    await tx.mediaCache.purge(id);
    effects.connections.add(id);
    effects.changed = true;
  }

  for (const record of ofKind('pin')) {
    const user = await tx.users.get(toUserId(record.key));
    if (!user) continue;
    const pin = record.deleted ? null : record.data.pin;
    if (pin === null) {
      if (!user.pinCredentialRef) continue;
      const { pinCredentialRef, ...without } = user;
      await tx.users.update(without);
      stale.push(pinCredentialRef);
      effects.changed = true;
      continue;
    }
    const ref = planned.get(identityOf(record));
    // No fresh ref: this device's PIN is that one already.
    if (!ref) continue;
    await tx.users.update({ ...user, pinCredentialRef: ref });
    adopted.add(ref);
    if (user.pinCredentialRef) stale.push(user.pinCredentialRef);
    effects.changed = true;
  }

  for (const record of ofKind('preference')) {
    const [owner = '', name = ''] = record.key.split('/');
    const userId = toUserId(owner);
    if (!(await tx.users.get(userId))) continue;
    const current = (await tx.preferences.get(userId)) as Readonly<Record<string, unknown>>;
    if (record.deleted ? current[name] === undefined : stableJson(current[name]) === stableJson(record.data.value)) continue;
    await tx.preferences.update(userId, (document) => {
      const next: Record<string, unknown> = { ...document };
      if (record.deleted) delete next[name];
      else next[name] = record.data.value;
      return next as UserPreferences;
    });
    effects.changed = true;
  }

  for (const record of ofKind('profileValues')) {
    const [ofConnection = '', ofUser = ''] = record.key.split('/');
    const connection = await tx.connections.get(toConnectionId(ofConnection));
    const userId = toUserId(ofUser);
    // A child whose parent is gone is skipped: a soft delete does not cascade on the server.
    if (!connection || !(await tx.users.get(userId))) continue;
    const local = (await tx.connections.profileValues(connection.id)).get(userId);
    if (record.deleted) {
      if (!local) continue;
      await tx.connections.deleteProfileValues(connection.id, userId);
      stale.push(...(local.credentialsRef ? [local.credentialsRef] : []), sessionRef(connection.id, userId));
    } else {
      const row = profileValuesOf(record, manifestOf(connection.pluginId), credentialsFor(planned, record, local?.credentialsRef, stale, adopted));
      if (local && stableJson(local) === stableJson(row)) continue;
      await tx.connections.putProfileValues(connection.id, userId, row);
    }
    await tx.mediaCache.purge(connection.id, userId);
    effects.connections.add(connection.id);
    effects.changed = true;
  }

  // Two devices that chose the same channel offline made two records for it,
  // which this device may hold only one of. The smaller id wins everywhere —
  // every device decides alike — and the other is deleted, so the server stops
  // sending it.
  const deduped: JournalAnnouncement[] = [];
  const deletion = (entity: 'subscription' | 'favoriteChannel', entityId: string, userId: UserId): JournalAnnouncement => ({
    userId,
    entity,
    entityId,
    operation: 'delete',
    localVersion: 0,
  });

  for (const record of ofKind('subscription')) {
    const local = await tx.subscriptions.get(record.key);
    if (record.deleted) {
      if (local) {
        await tx.subscriptions.remove(record.key);
        effects.changed = true;
      }
      continue;
    }
    const { data } = record;
    // A child whose parent is gone is skipped: a soft delete does not cascade.
    if (!(await tx.users.get(data.userId)) || !(await tx.connections.get(data.connectionId))) continue;
    const twin = local ? undefined : await tx.subscriptions.forChannel(data.userId, data.connectionId, data.externalId);
    if (twin) {
      if (twin.id < record.key) {
        deduped.push(deletion('subscription', record.key, data.userId));
        continue;
      }
      await tx.subscriptions.remove(twin.id);
      deduped.push(deletion('subscription', twin.id, data.userId));
    }
    const row = {
      id: data.subscriptionId,
      userId: data.userId,
      connectionId: data.connectionId,
      externalId: data.externalId,
      title: data.title,
      addedAt: data.addedAt,
      version: (local?.version ?? 0) + 1,
    };
    if (local && stableJson({ ...local, version: 0 }) === stableJson({ ...row, version: 0 })) continue;
    await tx.subscriptions.put(row);
    effects.changed = true;
  }

  for (const record of ofKind('favoriteChannel')) {
    const local = await tx.favoriteChannels.get(record.key);
    if (record.deleted) {
      if (local) {
        await tx.favoriteChannels.remove(record.key);
        effects.changed = true;
      }
      continue;
    }
    const { data } = record;
    // A child whose parent is gone is skipped: a soft delete does not cascade.
    if (!(await tx.users.get(data.userId)) || !(await tx.connections.get(data.connectionId))) continue;
    const twin = local ? undefined : await tx.favoriteChannels.forChannel(data.userId, data.connectionId, data.externalId);
    if (twin) {
      if (twin.id < record.key) {
        deduped.push(deletion('favoriteChannel', record.key, data.userId));
        continue;
      }
      await tx.favoriteChannels.remove(twin.id);
      deduped.push(deletion('favoriteChannel', twin.id, data.userId));
    }
    const row = {
      id: data.favoriteId,
      userId: data.userId,
      connectionId: data.connectionId,
      externalId: data.externalId,
      name: data.name,
      ...(data.number === undefined ? {} : { number: data.number }),
      ...(data.logo === undefined ? {} : { logo: imageRef(data.logo) }),
      addedAt: data.addedAt,
      version: (local?.version ?? 0) + 1,
    };
    if (local && stableJson({ ...local, version: 0 }) === stableJson({ ...row, version: 0 })) continue;
    await tx.favoriteChannels.put(row);
    effects.changed = true;
  }

  for (const record of ofKind('playlist')) {
    const local = await tx.playlists.get(record.key);
    if (record.deleted) {
      if (local) {
        await tx.playlists.remove(record.key);
        effects.changed = true;
      }
      continue;
    }
    const { data } = record;
    if (!(await tx.users.get(data.userId))) continue;
    const row = {
      id: data.playlistId,
      userId: data.userId,
      title: data.title,
      ...(data.description === undefined ? {} : { description: data.description }),
      items: data.items.map((item) => ({ connectionId: item.connectionId, externalId: item.externalId })),
      ...(data.source === undefined ? {} : { source: { connectionId: data.source.connectionId, externalId: data.source.externalId } }),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      version: (local?.version ?? 0) + 1,
    };
    if (local && stableJson({ ...local, version: 0 }) === stableJson({ ...row, version: 0 })) continue;
    await tx.playlists.put(row);
    effects.changed = true;
  }

  // Watch progress: merged field by field, pending or not — see mergeWatchProgress.
  const remerged: JournalAnnouncement[] = [];
  for (const record of records) {
    if (record.kind !== 'watchProgress') continue;
    const local = await tx.watchProgress.get(record.key);
    const waiting = pending.has(identityOf(record));
    if (record.deleted) {
      // Only a profile's deletion ends its history, and that one cascades; a
      // tombstone that comes anyway is taken, unless this device has more to say.
      if (local && !waiting) {
        await tx.watchProgress.remove(record.key);
        effects.changed = true;
      }
      continue;
    }
    const { data } = record;
    if (!(await tx.users.get(data.userId))) continue;
    const item = data.item === undefined ? undefined : snapshotOf(data.item);
    const server: WatchProgress = {
      id: record.key,
      userId: data.userId,
      identity: data.identity,
      ...(data.externalIds === undefined ? {} : { externalIds: data.externalIds }),
      round: data.round,
      watched: data.watched,
      ...(data.positionMs === undefined ? {} : { positionMs: data.positionMs }),
      ...(data.durationMs === undefined ? {} : { durationMs: data.durationMs }),
      ...(item === undefined ? {} : { item }),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      version: local?.version ?? 0,
    };
    const merged = local ? mergeWatchProgress(local, server, waiting) : server;
    if (!local || !sameProgress(local, merged)) {
      await tx.watchProgress.put({ ...merged, version: (local?.version ?? 0) + 1 });
      effects.changed = true;
    }
    // What the server holds is behind what the merge says: the next push sets it right.
    if (!waiting && !sameProgress(merged, server)) remerged.push(announcementOf('watchProgress', record.key));
  }

  for (const record of ofKind('setting')) {
    const local = await tx.accountSettings.get(record.key);
    if (record.deleted) {
      if (local) {
        await tx.accountSettings.remove(record.key);
        effects.changed = true;
      }
      continue;
    }
    if (local && stableJson(local.value) === stableJson(record.data.value)) continue;
    await tx.accountSettings.put({ name: record.key, value: record.data.value, version: (local?.version ?? 0) + 1 });
    effects.changed = true;
  }
  if (deduped.length > 0 || remerged.length > 0) await tx.journal.announce([...deduped, ...remerged]);

  // Rule 4: what the server has no record of, it lost.
  const here = new Set((await tx.users.list()).map((user) => user.id));
  // A profile held back and since deleted here has nothing left to wait for.
  const heldBack = new Set(state.heldBack.filter((userId) => here.has(userId)));
  if (options.restoreLost) {
    const room = options.maxProfiles - records.filter((record) => record.kind === 'profile' && !record.deleted).length;
    for (const userId of [...heldBack].slice(0, Math.max(room, 0))) heldBack.delete(userId);
    const lost = (await localIdentities(tx)).filter((local) => {
      const identity = identityOf(local);
      if (byIdentity.has(identity) || pending.has(identity) || options.refused?.has(identity)) return false;
      const owner = ownerOf(local);
      return owner === undefined || !heldBack.has(owner);
    });
    await tx.journal.announce(lost.map((local): JournalAnnouncement => announcementOf(local.kind, local.key, local.owner)));
  }
  await tx.account.putSync({ ...state, heldBack: [...heldBack] });

  return { ...effects, stale, adopted };
}

/** Only what the contract allows, and each record once; the rest is left out, and said so — never with its values. */
function understood(snapshot: readonly AccountRecord[], parts: SyncParts): readonly AccountRecord[] {
  const seen = new Set<string>();
  return snapshot.filter((record) => {
    if (!isAccountRecord(record)) {
      parts.log.warn('sync', 'A record from the account was not understood, and was left out');
      return false;
    }
    const identity = identityOf(record);
    if (seen.has(identity)) return false;
    seen.add(identity);
    // A sync plugin's connection never travels: one arriving is someone else's mistake.
    return record.kind !== 'connection' || record.deleted || accountWide(record.data.pluginId);
  });
}

/**
 * Every PIN and password the records bring, written under fresh refs before
 * the transaction — unless this device holds exactly that already. A record's
 * passwords are the server's, with any it lists but lacks kept from this
 * device's own.
 */
async function planSecrets(
  parts: SyncParts,
  records: readonly AccountRecord[],
  pending: ReadonlySet<string>,
  keepLocal: boolean,
): Promise<Map<string, CredentialsRef>> {
  const planned = new Map<string, CredentialsRef>();
  const read = async (ref: CredentialsRef | undefined): Promise<Credentials> => (ref && (await parts.credentials.read(ref).catch(() => undefined))) || {};
  const write = async (identity: string, credentials: Credentials) => {
    const ref = toCredentialsRef(parts.ids.next());
    await parts.credentials.write(ref, credentials);
    planned.set(identity, ref);
  };
  try {
    for (const record of records) {
      if (record.deleted || pending.has(identityOf(record))) continue;
      const identity = identityOf(record);
      if (record.kind === 'pin') {
        if (record.data.pin === null) continue;
        const user = keepLocal ? await parts.db.users.get(toUserId(record.key)) : undefined;
        if (user && (await read(user.pinCredentialRef)).pin === record.data.pin) continue;
        await write(identity, { pin: record.data.pin });
      } else if (record.kind === 'connection' || record.kind === 'profileValues') {
        const local = keepLocal ? await localValuesOf(parts, record) : undefined;
        const held = await read(local?.credentialsRef);
        const next = secretsOf(record.data, held);
        if (Object.keys(next).length === 0) continue;
        if (local?.credentialsRef && stableJson(pick(held, Object.keys(next))) === stableJson(next) && Object.keys(held).length === Object.keys(next).length) continue;
        await write(identity, next);
      }
    }
  } catch (error) {
    for (const ref of planned.values()) await parts.credentials.delete(ref).catch(() => undefined);
    throw error;
  }
  return planned;
}

async function localValuesOf(parts: SyncParts, record: Live<'connection'> | Live<'profileValues'>): Promise<ProfileValues | undefined> {
  if (record.kind === 'connection') return (await parts.db.connections.get(toConnectionId(record.key)))?.values;
  return (await parts.db.connections.profileValues(record.data.connectionId)).get(record.data.userId);
}

/** The passwords a record holds: the server's, and this device's for a name it lists without a value. */
function secretsOf(data: RecordData['connection'] | RecordData['profileValues'], held: Credentials): Credentials {
  const next: Record<string, string> = {};
  for (const name of data.secretKeys) {
    const value = data.secrets[name] ?? held[name];
    if (value !== undefined) next[name] = value;
  }
  return next;
}

/** The ref a row takes: the one planned for it, or the one it has — or none, when it holds no password. */
function credentialsFor(
  planned: ReadonlyMap<string, CredentialsRef>,
  record: Live<'connection'> | Live<'profileValues'>,
  current: CredentialsRef | undefined,
  stale: CredentialsRef[],
  adopted: Set<CredentialsRef>,
): CredentialsRef | undefined {
  const fresh = planned.get(identityOf(record));
  if (fresh) {
    adopted.add(fresh);
    if (current) stale.push(current);
    return fresh;
  }
  if (record.data.secretKeys.length === 0) {
    if (current) stale.push(current);
    return undefined;
  }
  return current;
}

function connectionOf(record: Live<'connection'>, manifest: PluginManifest | undefined, ref: CredentialsRef | undefined): Connection {
  const { data } = record;
  const secretKeys = passwordsOf(manifest, data.secretKeys);
  return {
    id: data.connectionId,
    pluginId: data.pluginId,
    label: data.label,
    enabled: data.enabled,
    perProfile: data.perProfile,
    values: {
      fields: declared(data.fields, manifest?.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key)),
      settings: declared(data.settings, manifest?.settings.map((setting) => setting.key)),
      ...(ref ? { credentialsRef: ref } : {}),
      ...(secretKeys.length > 0 ? { secretKeys } : {}),
    },
  };
}

function profileValuesOf(record: Live<'profileValues'>, manifest: PluginManifest | undefined, ref: CredentialsRef | undefined): ProfileValues {
  const { data } = record;
  // Switched off, a profile's values hold nothing else — as a save writes them.
  if (data.off) return { fields: {}, settings: {}, off: true };
  const secretKeys = passwordsOf(manifest, data.secretKeys);
  return {
    fields: declared(data.fields, manifest?.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key)),
    settings: declared(data.settings, manifest?.settings.map((setting) => setting.key)),
    ...(ref ? { credentialsRef: ref } : {}),
    ...(secretKeys.length > 0 ? { secretKeys } : {}),
  };
}

/** Only a manifest's password fields are ever listed as saved passwords. A plugin this build lacks keeps what it had. */
function passwordsOf(manifest: PluginManifest | undefined, listed: readonly string[]): readonly string[] {
  if (!manifest) return listed;
  const passwords = new Set(manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key));
  return listed.filter((key) => passwords.has(key));
}

/** Only what the manifest declares is kept, so nothing a server adds is ever stored. */
function declared(values: FieldValues, keys: readonly string[] | undefined): FieldValues {
  if (!keys) return values;
  const picked: Record<string, FieldValue> = {};
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
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
 * Every account-wide row this device holds, as the identity of its record. A
 * profile without a PIN has nothing to lose: no record of one says the same.
 */
async function localIdentities(tx: Repositories): Promise<readonly LocalIdentity[]> {
  const identities: LocalIdentity[] = [];
  for (const user of await tx.users.list()) {
    identities.push({ kind: 'profile', key: user.id });
    if (user.pinCredentialRef) identities.push({ kind: 'pin', key: user.id });
    for (const name of Object.keys(await tx.preferences.get(user.id))) identities.push({ kind: 'preference', key: `${user.id}/${name}` });
  }
  // Their key is a generated id and names no profile, so the owner is carried.
  for (const subscription of await tx.subscriptions.listAll()) {
    identities.push({ kind: 'subscription', key: subscription.id, owner: subscription.userId });
  }
  for (const favorite of await tx.favoriteChannels.listAll()) {
    identities.push({ kind: 'favoriteChannel', key: favorite.id, owner: favorite.userId });
  }
  for (const playlist of await tx.playlists.listAll()) identities.push({ kind: 'playlist', key: playlist.id, owner: playlist.userId });
  for (const progress of await tx.watchProgress.listAll()) identities.push({ kind: 'watchProgress', key: progress.id, owner: progress.userId });
  for (const setting of await tx.accountSettings.list()) identities.push({ kind: 'setting', key: setting.name });
  for (const connection of await tx.connections.list()) {
    if (!accountWide(connection.pluginId)) continue;
    identities.push({ kind: 'connection', key: connection.id });
    for (const userId of (await tx.connections.profileValues(connection.id)).keys()) {
      identities.push({ kind: 'profileValues', key: `${connection.id}/${userId}` });
    }
  }
  return identities;
}

/** A local row's identity, with whose it is where the key does not say. */
interface LocalIdentity extends Pick<AccountRecord, 'kind' | 'key'> {
  readonly owner?: UserId;
}

/** The profile a record belongs to, if it is one's. */
function ownerOf(record: LocalIdentity): UserId | undefined {
  if (record.owner !== undefined) return record.owner;
  const [first, second] = record.key.split('/');
  if (record.kind === 'profile' || record.kind === 'pin' || record.kind === 'preference') return toUserId(first ?? '');
  return record.kind === 'profileValues' ? toUserId(second ?? '') : undefined;
}
