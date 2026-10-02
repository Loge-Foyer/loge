import {
  AppError,
  isAppError,
  userId as toUserId,
  type AccountRecord,
  type Connection,
  type Credentials,
  type FieldValues,
  type PluginId,
  type PluginManifest,
  type UserId,
} from '@loge/api';

import { draftOf } from './connection-draft';
import type { ConnectionDraft, ConnectionService, SavePlan } from './connections';
import type { OwnerCheck, OwnerVerdict } from './owner-check';
import type { PluginCatalog } from './plugin-catalog';
import { profileLimitOf } from './profiles';
import type { IdGenerator, JournalAnnouncement, Repositories, RunLock, SyncDatabase } from './ports';
import { removeAccountRowsIn, removeConnectionIn } from './removal';
import { accountWide } from './scope';
import type { SecretJanitor } from './secrets';
import { sessionIdentity, type Sessions } from './sessions';
import { currentAccount, type CurrentAccount } from './sync/current';
import { SYNC_LOCK, type SyncEngine } from './sync/engine';
import type { SyncParts } from './sync/parts';
import type { AccountProviders } from './sync/provider';
import { announcementOf } from './sync/records';
import { applyRecords, discardPlan, planRecords, unusedOf, type Outcome } from './sync/reconcile';
import type { SyncScheduler } from './sync/scheduler';

const FINAL_PUSH_MS = 5_000;
const SIGN_OUT_MS = 5_000;

/** Where signing in goes: your own server, or the account this device is signed in to already, with a new password. */
export interface ServerTarget {
  readonly pluginId: PluginId;
  readonly draft: ConnectionDraft;
  /** Create the account with these `signUp` fields, rather than sign in to one. */
  readonly signUp?: FieldValues;
  /** Signing in again: the account stays this device's, and only its password changes. */
  readonly again?: true;
}

/** A sign-in tried, and what it found — nothing saved yet. */
export interface PreparedAccount {
  /**
   * `replace`: the account as the server holds it replaces this device's.
   * `upload`: a new account, and this device's goes up to it.
   * `again`: the same account, signed in to anew.
   */
  readonly kind: 'replace' | 'upload' | 'again';
  readonly accountId: string;
  readonly accountName: string;
  readonly maxProfiles: number;
  readonly manifest: PluginManifest;
  readonly draft: ConnectionDraft;
  readonly existing?: Connection;
  /** The account's records, for a replace. */
  readonly records: readonly AccountRecord[];
  /** The account's profiles, by name. */
  readonly accountProfiles: readonly string[];
  /** This device's profiles, by name: what a replace takes away. */
  readonly deviceProfiles: readonly string[];
  /** What the sign-in left in its session, which becomes the account's own: nothing signs in twice. Memory only. */
  readonly session?: string;
  /** The account was created by this sign-in. It exists now: going back, the form signs in to it, never creates it again. */
  readonly created?: true;
}

/**
 * An account was created, and what came after did not go through. It exists
 * now, so the form signs in to it from here on — creating it again would be
 * refused.
 */
export class AccountCreatedError extends Error {
  constructor(cause: unknown) {
    super('Your account was created, but signing in did not finish.', { cause });
    this.name = 'AccountCreatedError';
  }
}

/** The owner was not verified, so nothing changed. `cancelled` is someone backing out, not an error to show. */
export class OwnerNotVerifiedError extends Error {
  readonly verdict: OwnerVerdict;

  constructor(verdict: OwnerVerdict) {
    super(
      verdict === 'refused'
        ? 'That did not confirm it’s you.'
        : verdict === 'failed'
          ? 'Your account could not be reached to confirm it’s you.'
          : verdict === 'throttled'
            ? 'Too many tries. Wait a little, then try again.'
            : 'Not confirmed.',
    );
    this.name = 'OwnerNotVerifiedError';
    this.verdict = verdict;
  }
}

export interface AccountService {
  current(): Promise<CurrentAccount | undefined>;
  /** Where the account can live on a server: the sync plugins with an account role, on this platform. */
  servers(): readonly PluginManifest[];
  /** How many profiles the account may hold. */
  maxProfiles(): Promise<number>;
  /** Profiles your server refused for its limit: they stay on this device only. */
  heldBack(): Promise<ReadonlySet<UserId>>;
  /** At launch: a device that has profiles and no account — it came from an earlier version — keeps them as a local account. */
  ensureAccount(): Promise<void>;
  /** The first launch: an account on this device, and its first profile named after it. */
  createLocal(name: string): Promise<UserId>;
  /**
   * The owner check (when there is something to protect), one try at signing
   * in — or at creating the account — and, for a sign-in, the whole account
   * read. Signing in again takes only the password, and no owner check: the
   * password is the proof.
   */
  prepare(target: ServerTarget, proof?: Credentials): Promise<PreparedAccount>;
  /** Saves what `prepare` found: a replace, an upload, or the same account signed in to anew. */
  complete(prepared: PreparedAccount): Promise<{ readonly profilesArrived: number }>;
  /** Back to an account on this device: everything stays, the server is let go of. */
  signOut(proof?: Credentials): Promise<void>;
}

export function createAccountService(deps: {
  readonly db: SyncDatabase;
  readonly catalog: PluginCatalog;
  readonly connections: ConnectionService;
  readonly owner: OwnerCheck;
  readonly providers: AccountProviders;
  readonly engine: SyncEngine;
  readonly scheduler: SyncScheduler;
  readonly janitor: SecretJanitor;
  readonly lock: RunLock;
  readonly parts: SyncParts;
  readonly sessions: Sessions;
  readonly ids: IdGenerator;
}): AccountService {
  const { db, catalog, connections, owner, providers, engine, scheduler, sessions, ids } = deps;

  // Nothing to protect on a device without profiles: the first launch needs no owner.
  const guard = async (reason: string, proof?: Credentials) => {
    if ((await db.users.list()).length === 0) return;
    const verdict = await owner.verify(reason, proof);
    // Where no owner can be asked — a browser on an account kept here — account actions stay open.
    if (verdict === 'verified' || verdict === 'unavailable') return;
    throw new OwnerNotVerifiedError(verdict);
  };

  // The sign-in just made becomes the account's session. Inside the run lock, so no run starts between the two and signs in again.
  const takeSession = async (connection: Connection, manifest: PluginManifest, value: string) => {
    await sessions.bind(connection.id, 'account', sessionIdentity(manifest, connection.values)).write(value);
    // A provider already running for it would go on with the session it had.
    providers.forget();
  };

  // Once, and briefly: the server forgets this device's session if it can; the device lets go whatever it answers.
  const letGoAtServer = async (account: CurrentAccount) => {
    if (account.kind !== 'server' || !account.available) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGN_OUT_MS);
    try {
      await (await providers.provider(account.connection)).signOut?.(controller.signal);
    } catch (error) {
      deps.parts.log.warn('sync', 'The account could not be told this device signed out', { code: isAppError(error) ? error.code : 'unknown' });
    } finally {
      clearTimeout(timer);
    }
  };

  const manifestOf = (pluginId: PluginId) => {
    const manifest = catalog.get(pluginId);
    if (!manifest || !catalog.accountRole(pluginId)) {
      throw new AppError('INVALID_STATE', 'This account cannot be used in this version of the app.', { retry: 'never' });
    }
    return manifest;
  };

  /** Every account-wide row this device holds, announced as if just changed: the upload a sign-up starts with. */
  const everything = async (tx: Repositories): Promise<readonly JournalAnnouncement[]> => {
    const announced: JournalAnnouncement[] = [];
    for (const user of await tx.users.list()) {
      announced.push(announcementOf('profile', user.id));
      if (user.pinCredentialRef) announced.push(announcementOf('pin', user.id));
      for (const name of Object.keys(await tx.preferences.get(user.id))) announced.push(announcementOf('preference', `${user.id}/${name}`));
    }
    // After the profiles and before the connections' values: a subscription
    // and a favourite channel point at a connection, which the loop below
    // announces.
    for (const playlist of await tx.playlists.listAll()) announced.push(announcementOf('playlist', playlist.id, playlist.userId));
    // What a profile watched, and the account's own settings, go up with it.
    for (const progress of await tx.watchProgress.listAll()) announced.push(announcementOf('watchProgress', progress.id));
    for (const setting of await tx.accountSettings.list()) announced.push(announcementOf('setting', setting.name));
    const children: JournalAnnouncement[] = [];
    for (const subscription of await tx.subscriptions.listAll()) {
      children.push(announcementOf('subscription', subscription.id, subscription.userId));
    }
    for (const favorite of await tx.favoriteChannels.listAll()) {
      children.push(announcementOf('favoriteChannel', favorite.id, favorite.userId));
    }
    for (const connection of await tx.connections.list()) {
      if (!accountWide(connection.pluginId)) continue;
      announced.push(announcementOf('connection', connection.id));
      for (const userId of (await tx.connections.profileValues(connection.id)).keys()) {
        children.push(announcementOf('profileValues', `${connection.id}/${userId}`));
      }
    }
    return [...announced, ...children];
  };

  return {
    current: () => currentAccount(db, catalog),

    servers: () => catalog.inCategory('sync').filter((manifest) => catalog.accountRole(manifest.id) !== undefined),

    maxProfiles: async () => profileLimitOf(await db.account.get()),

    heldBack: async () => {
      const account = await db.account.get();
      return new Set(account?.kind === 'server' ? (await db.account.sync()).heldBack : []);
    },

    ensureAccount: async () => {
      await db.unjournaled(async (tx) => {
        if (await tx.account.get()) return;
        const users = await tx.users.list();
        if (users.length === 0) return;
        const settings = await tx.deviceSettings.get();
        const named = users.find((user) => user.id === settings.defaultUserId) ?? users[0];
        if (named) await tx.account.put({ kind: 'local', id: ids.next(), name: named.name });
      });
    },

    createLocal: async (name) => {
      const trimmed = name.trim();
      if (trimmed === '') throw new Error('The account needs a name.');
      const id = toUserId(ids.next());
      await db.transaction(async (tx) => {
        if (await tx.account.get()) throw new AppError('INVALID_STATE', 'This device has an account already.', { retry: 'never' });
        await tx.account.put({ kind: 'local', id: ids.next(), name: trimmed });
        await tx.users.insert({ id, name: trimmed });
        await tx.deviceSettings.update((current) => ({ ...current, defaultUserId: id }));
      });
      return id;
    },

    prepare: async (target, proof) => {
      const manifest = manifestOf(target.pluginId);
      const current = await currentAccount(db, catalog);
      const again = target.again === true && current?.kind === 'server' && current.connection.pluginId === target.pluginId;
      let draft = target.draft;
      let existing: Connection | undefined;
      if (again) {
        const edit = await connections.edit(current.connection.id);
        if (!edit) throw new AppError('NOT_FOUND', 'That connection is no longer here.', { retry: 'never' });
        existing = edit.connection;
        const stored = draftOf(manifest, edit);
        // The same account again: its details stay — a new address would be another account.
        draft = { ...stored, shared: { ...stored.shared, secrets: target.draft.shared.secrets } };
      }
      if (!again) await guard('Confirm it’s you to change the account this device uses', proof);

      const deviceProfiles = (await db.users.list()).map((user) => user.name);
      const credentials = await connections.probeSecrets(manifest.id, existing?.id, 'shared', draft.shared.secrets);
      // One try, whatever it answers: a refused sign-in, or a refused account, is never tried again by itself.
      const { account: probe, session } = await providers.probe(manifest.id, { fields: draft.shared.fields, settings: draft.shared.settings }, credentials);
      let created = false;
      try {
        const info = await probe.info();
        let kind: PreparedAccount['kind'];
        let status;
        if (target.signUp) {
          if (!probe.createAccount) throw new AppError('INVALID_STATE', `${manifest.displayName} cannot create an account here.`, { retry: 'never' });
          // An upload that could not fit is refused before anything is made.
          if (deviceProfiles.length > info.maxProfiles) {
            throw new AppError('INVALID_STATE', `This device holds ${deviceProfiles.length} profiles; an account on this server holds up to ${info.maxProfiles}.`, {
              retry: 'never',
            });
          }
          status = await probe.createAccount(target.signUp, { firstProfile: deviceProfiles.length === 0 });
          created = true;
          kind = deviceProfiles.length === 0 ? 'replace' : 'upload';
        } else {
          status = await probe.status();
          kind = again ? 'again' : 'replace';
        }
        const records = kind === 'replace' ? (await probe.pull()).records : [];
        const signedIn = await session();
        return {
          kind,
          accountId: status.accountId,
          accountName: status.accountName,
          maxProfiles: info.maxProfiles,
          manifest,
          // A connection made for the account is named the way the account names itself.
          draft: existing ? draft : { ...draft, label: status.accountName, enabled: true, perProfile: 'none' },
          ...(existing ? { existing } : {}),
          records,
          accountProfiles: records.flatMap((record) => (record.kind === 'profile' && !record.deleted ? [record.data.name] : [])),
          deviceProfiles,
          ...(signedIn ? { session: signedIn } : {}),
          ...(created ? { created: true as const } : {}),
        };
      } catch (error) {
        if (created) throw new AccountCreatedError(error);
        throw error;
      } finally {
        await probe.dispose().catch(() => undefined);
      }
    },

    complete: async (prepared) => {
      const current = await currentAccount(db, catalog);

      if (prepared.kind === 'again' && prepared.existing) {
        const { existing, session } = prepared;
        // The same account with a new password: saved like any connection, then synced again — as the sign-in just made.
        await deps.lock.run(SYNC_LOCK, async () => {
          const connection = await connections.update(existing.id, prepared.draft);
          if (session) await takeSession(connection, prepared.manifest, session);
        });
        await scheduler.accountChanged();
        return { profilesArrived: 0 };
      }

      // Best effort: what the old account has not had yet reaches it now, before this device lets it go.
      if (current?.kind === 'server') await engine.finalPush(FINAL_PUSH_MS);

      const planned: SavePlan = await connections.plan(prepared.manifest.id, prepared.draft, undefined);
      const plan = prepared.kind === 'replace' ? await planRecords(deps.parts, prepared.records, { keepLocal: false }) : undefined;
      let applied: Outcome | undefined;
      try {
        await deps.lock.run(SYNC_LOCK, async () => {
          // The account being left hears once that this device goes, whatever it answers.
          if (current?.kind === 'server') await letGoAtServer(current);
          applied = await db.unjournaled(async (tx) => {
            // The account this device had goes: its connection, and the session with it.
            const before = await tx.account.get();
            if (before?.kind === 'server') await removeConnectionIn(tx, before.connectionId);
            // Before the account's rows go: the save checks it finds the profiles it was planned with.
            await connections.commit(tx, planned);
            if (prepared.kind === 'replace') await removeAccountRowsIn(tx);
            await tx.account.put({
              kind: 'server',
              id: prepared.accountId,
              name: prepared.accountName,
              connectionId: planned.connection.id,
              maxProfiles: prepared.maxProfiles,
            });
            // Nothing before this is this account's to send.
            await tx.account.putSync({ checkpoint: await tx.journal.head(), heldBack: [] });
            if (plan) {
              const outcome = await applyRecords(tx, deps.parts, plan, { maxProfiles: prepared.maxProfiles, restoreLost: false });
              await tx.staleSecrets.add(unusedOf(plan, outcome));
              return outcome;
            }
            // An upload: every row goes up with the first push.
            await tx.journal.announce(await everything(tx));
            return undefined;
          });
          if (prepared.session) await takeSession(planned.connection, prepared.manifest, prepared.session);
        });
      } catch (error) {
        await connections.discard(planned);
        if (plan) await discardPlan(deps.parts, plan);
        throw error;
      }
      await deps.janitor.drain();
      const outcome = applied as Outcome | undefined;
      // Profiles that arrived, or went: the gate and whatever holds on to them hear of it.
      if (outcome) engine.report(outcome);
      await scheduler.accountChanged();
      return { profilesArrived: outcome?.arrivedProfiles.size ?? 0 };
    },

    signOut: async (proof) => {
      const current = await currentAccount(db, catalog);
      if (current?.kind !== 'server') return;
      await guard('Confirm it’s you to sign out of the account', proof);
      await engine.finalPush(FINAL_PUSH_MS);
      await deps.lock.run(SYNC_LOCK, async () => {
        await letGoAtServer(current);
        await db.unjournaled(async (tx) => {
          await removeConnectionIn(tx, current.connection.id);
          // Everything stays, and is this device's own from now on.
          await tx.account.clear();
          await tx.account.put({ kind: 'local', id: ids.next(), name: current.name });
          await tx.journal.prune(await tx.journal.head());
        });
      });
      await deps.janitor.drain();
      await scheduler.accountChanged();
    },
  };
}
