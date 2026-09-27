import {
  AppError,
  effectiveRoles,
  isAppError,
  type Connection,
  type ConnectionId,
  type Credentials,
  type FieldValues,
  type PluginId,
  type PluginManifest,
  type SyncCapability,
  type SyncStatus as AccountStatus,
} from '@sc/api';

import { draftOf } from './connection-draft';
import { InvalidDraftError, type ConnectionDraft, type ConnectionService } from './connections';
import type { OwnerCheck, OwnerVerdict } from './owner-check';
import type { PluginCatalog } from './plugin-catalog';
import type { Repositories, RunLock, SyncDatabase } from './ports';
import { removeConnectionIn } from './removal';
import type { SecretJanitor } from './secrets';
import type { Applied, SyncParts } from './sync/apply';
import { currentAccount, type CurrentAccount } from './sync/current';
import type { SyncEngine } from './sync/engine';
import { joinAccount, previewAccount, type AccountPreview } from './sync/join';
import type { AccountProviders } from './sync/provider';
import type { SyncScheduler } from './sync/scheduler';
import { vaultOnce } from './sync/sealed';
import { sessionIdentity, sessionRef, type Sessions } from './sessions';

const FINAL_PUSH_MS = 5_000;
const SIGN_OUT_MS = 5_000;
const LOCK = 'streaming-center-sync';

/** A plugin that can be the device's account, and this device's connections of it that could become it — none kept per profile. */
export interface AccountProvider {
  readonly manifest: PluginManifest;
  readonly connections: readonly Connection[];
}

/**
 * Where a sign-in goes: a new connection of a plugin — an account that exists
 * already, or one to create with its `signUp` fields — or one of this
 * device's connections.
 */
export type SignInTarget =
  | { readonly pluginId: PluginId; readonly draft: ConnectionDraft; readonly signUp?: FieldValues }
  | { readonly connectionId: ConnectionId; readonly draft?: ConnectionDraft };

/** A sign-in tried and the account read — nothing saved yet. */
export interface PreparedSignIn {
  readonly accountName?: string;
  /** Both sides hold profiles the other lacks: ask "Use the account's profiles" or "Keep both". */
  readonly ask: boolean;
  /** The account's profiles, by name. */
  readonly accountProfiles: readonly string[];
  /** This device's profiles the account lacks, by name — what "Use the account's profiles" removes. */
  readonly onlyHere: readonly string[];
  /** It replaces the account this device has. */
  readonly switching: boolean;
  /** It only signs in to this device's account again, with new details. */
  readonly again: boolean;
  readonly manifest: PluginManifest;
  readonly existing?: Connection;
  readonly draft: ConnectionDraft;
  readonly carried: ReadonlySet<SyncCapability>;
  readonly preview?: AccountPreview;
  /** The account's vault key, read while the sign-in was open: the join opens the passwords the account holds with it. Memory only. */
  readonly vaultKey?: Uint8Array;
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
  providers(): Promise<readonly AccountProvider[]>;
  /**
   * The owner check (when there is something to protect), one try at signing
   * in — or at creating the account — and the whole account read. `proof` is
   * the current account's owner proof, when switching away from one that asks.
   * Signing in to this device's account again takes only its passwords, and
   * no owner check: the password is the proof.
   */
  prepareSignIn(target: SignInTarget, proof?: Credentials): Promise<PreparedSignIn>;
  /** One transaction: the account's connection, the account's changes, this device's announced. */
  completeSignIn(prepared: PreparedSignIn, profiles: 'account' | 'both'): Promise<{ readonly profilesArrived: number }>;
  /** Everything stays on the device; only the account is let go — at the server too, where it can be in a moment. */
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
}): AccountService {
  const { db, catalog, connections, owner, providers, engine, scheduler, sessions } = deps;

  // Nothing to protect on a device without profiles: the first launch needs no owner.
  const guard = async (reason: string, proof?: Credentials) => {
    if ((await db.users.list()).length === 0) return;
    const verdict = await owner.verify(reason, proof);
    // Where no owner can be asked — a browser without an account — account actions stay open.
    if (verdict === 'verified' || verdict === 'unavailable') return;
    throw new OwnerNotVerifiedError(verdict);
  };

  // Letting an account go: its state goes, and its session — the vault key with it — and so does a connection that was only ever the account.
  const leave = async (tx: Repositories, connection: Connection) => {
    await tx.syncState.remove(connection.id);
    const servesMedia = connection.roles.media === true && catalog.get(connection.pluginId)?.media !== undefined;
    if (servesMedia) {
      await tx.connections.update({ ...connection, roles: { ...connection.roles, sync: false } });
      await tx.staleSecrets.add([sessionRef(connection.id, 'account')]);
    } else {
      await removeConnectionIn(tx, connection.id);
    }
  };

  const carriedBy = (manifest: PluginManifest, draft: ConnectionDraft): ReadonlySet<SyncCapability> =>
    effectiveRoles(manifest, { roles: { sync: true }, settings: draft.shared.settings }).sync?.capabilities ?? new Set();

  // The sign-in just made becomes the account's session. Inside the run lock, so no run starts between the two and signs in again.
  const takeSession = async (connection: Connection, manifest: PluginManifest, value: string) => {
    await sessions.bind(connection.id, 'account', sessionIdentity(manifest, connection.values)).write(value);
    // A provider already running for it would go on with the session it had — a revoke's tombstone, say.
    providers.forget();
  };

  // Once, and briefly: the server lets this device go if it can; the device lets go of the account whatever it answers.
  const letGoAtServer = async (account: CurrentAccount) => {
    if (!account.available) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGN_OUT_MS);
    try {
      const provider = await providers.provider(account.connection);
      await provider.signOut?.(controller.signal);
    } catch (error) {
      deps.parts.log.warn('sync', 'The account could not be told this device signed out', {
        code: isAppError(error) ? error.code : 'unknown',
      });
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    current: () => currentAccount(db, catalog),

    providers: async () => {
      const all = await db.connections.list();
      return catalog
        .list()
        .filter((manifest) => catalog.syncRole(manifest.id) !== undefined)
        .map((manifest) => ({
          manifest,
          connections: all.filter(
            (connection) => connection.pluginId === manifest.id && connection.roles.sync !== true && connection.perProfile === 'none',
          ),
        }));
    },

    prepareSignIn: async (target, proof) => {
      const current = await currentAccount(db, catalog);
      let manifest: PluginManifest | undefined;
      let existing: Connection | undefined;
      let draft: ConnectionDraft;
      if ('connectionId' in target) {
        const edit = await connections.edit(target.connectionId);
        if (!edit) throw new AppError('NOT_FOUND', 'That connection is no longer here.', { retry: 'never' });
        existing = edit.connection;
        manifest = catalog.get(existing.pluginId);
        if (!manifest) throw new AppError('INVALID_STATE', 'This account cannot be used in this version of the app.', { retry: 'never' });
        const stored = draftOf(manifest, edit);
        // The same account again: its details stay — a new endpoint would be another account, reached without switching.
        draft =
          current?.connection.id === existing.id
            ? { ...stored, shared: { ...stored.shared, secrets: target.draft?.shared.secrets ?? {} } }
            : (target.draft ?? stored);
      } else {
        manifest = catalog.get(target.pluginId);
        if (!manifest) throw new AppError('INVALID_STATE', 'This account cannot be used in this version of the app.', { retry: 'never' });
        // Signing in to an account never also makes it a media source.
        draft = { ...target.draft, roles: { ...target.draft.roles, ...(manifest.media ? { media: false } : {}) } };
      }
      if (!catalog.syncRole(manifest.id)) {
        throw new AppError('INVALID_STATE', `${manifest.displayName} cannot be an account yet.`, { retry: 'never' });
      }
      if (draft.perProfile !== 'none') {
        throw new InvalidDraftError({ shared: {}, profiles: {}, form: 'Your account belongs to this device, so it keeps nothing per profile.' });
      }

      const again = existing !== undefined && current?.connection.id === existing.id;
      if (!again) await guard('Confirm it’s you to sign in to an account', proof);
      const carried = carriedBy(manifest, draft);
      const credentials = await connections.probeSecrets(manifest.id, existing?.id, 'shared', draft.shared.secrets);
      const signUp = 'pluginId' in target ? target.signUp : undefined;
      // One try, whatever it answers: a refused sign-in, or a refused account, is never tried again by itself.
      const { provider: probe, session } = await providers.probe(manifest.id, { fields: draft.shared.fields, settings: draft.shared.settings }, credentials);
      let created = false;
      try {
        let status: AccountStatus;
        if (signUp) {
          if (!probe.createAccount) throw new AppError('INVALID_STATE', `${manifest.displayName} cannot create an account here.`, { retry: 'never' });
          status = await probe.createAccount(signUp);
          created = true;
        } else {
          status = await probe.getStatus();
        }
        const preview = again ? undefined : await previewAccount(probe, carried, deps.parts);
        // Read before the probe goes: the join needs it, and asking again would sign in again.
        const vaultKey = preview && carried.has('sealedPasswords') ? await probe.vaultKey?.() : undefined;
        const signedIn = await session();
        const local = await db.users.list();
        const accountProfiles = (preview?.changes ?? []).flatMap((change) =>
          change.entity === 'profile' && change.operation === 'upsert' ? [change.data.name] : [],
        );
        // Nothing to choose between unless the account has profiles of its own.
        const onlyHere = preview && preview.profiles.size > 0 ? local.filter((user) => !preview.profiles.has(user.id)).map((user) => user.name) : [];
        return {
          ...(status.accountName ? { accountName: status.accountName } : {}),
          ask: onlyHere.length > 0,
          accountProfiles,
          onlyHere,
          switching: current !== undefined && !again,
          again,
          manifest,
          ...(existing ? { existing } : {}),
          // A connection made for the account is named the way the account names itself.
          draft: !existing && status.accountName ? { ...draft, label: status.accountName } : draft,
          carried,
          ...(preview ? { preview } : {}),
          ...(vaultKey ? { vaultKey } : {}),
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

    completeSignIn: async (prepared, profiles) => {
      if (prepared.again && prepared.existing) {
        const { existing, session } = prepared;
        // The same account with new details: saved like any connection, then synced again — as the sign-in just made.
        await deps.lock.run(LOCK, async () => {
          const connection = await connections.update(existing.id, prepared.draft);
          if (session) await takeSession(connection, prepared.manifest, session);
        });
        await scheduler.accountChanged();
        return { profilesArrived: 0 };
      }
      const { preview } = prepared;
      if (!preview) throw new AppError('INVALID_STATE', 'This sign-in was not read through. Try again.', { retry: 'never' });
      const current = await currentAccount(db, catalog);
      // Best effort: what the old account has not had yet reaches it now, or with the join below.
      if (prepared.switching && current?.available) await engine.finalPush(FINAL_PUSH_MS);

      const planned = await connections.plan(prepared.manifest.id, prepared.draft, prepared.existing, { sync: true });
      const { vaultKey } = prepared;
      let arrived = 0;
      let reported: Applied | undefined;
      try {
        await deps.lock.run(LOCK, async () => {
          const applied = await joinAccount(
            deps.parts,
            planned.connection,
            prepared.carried,
            preview,
            { kind: 'sign-in', profiles: prepared.ask ? profiles : 'both' },
            {
              inTransaction: async (tx) => {
                for (const connection of await tx.connections.list()) {
                  if (connection.roles.sync !== true || connection.id === planned.connection.id) continue;
                  // Leaving an account: what changes here from now on is this device's own.
                  const head = await tx.journal.head();
                  await tx.deviceSettings.update((settings) => ({ ...settings, leftAccountAt: head }));
                  await leave(tx, connection);
                }
                await connections.commit(tx, planned);
                const pluginId = prepared.manifest.id;
                await tx.deviceSettings.update((settings) =>
                  settings.plugins[pluginId]?.enabled ? settings : { ...settings, plugins: { ...settings.plugins, [pluginId]: { enabled: true } } },
                );
              },
              ...(vaultKey ? { vault: vaultOnce(deps.parts.crypto, () => Promise.resolve(vaultKey)) } : {}),
            },
          );
          if (prepared.session) await takeSession(planned.connection, prepared.manifest, prepared.session);
          arrived = applied.arrivedProfiles.size;
          reported = applied;
        });
      } catch (error) {
        await connections.discard(planned);
        throw error;
      }
      // The old account's provider still holds its session, whatever the join queued.
      if (prepared.switching && current) await letGoAtServer(current);
      await deps.janitor.drain();
      // Profiles that arrived, or went: the gate and whatever holds on to them hear of it.
      if (reported) engine.report(reported);
      await scheduler.accountChanged();
      return { profilesArrived: arrived };
    },

    signOut: async (proof) => {
      const current = await currentAccount(db, catalog);
      if (!current) return;
      await guard('Confirm it’s you to sign out of the account', proof);
      await deps.lock.run(LOCK, async () => {
        await letGoAtServer(current);
        await db.unjournaled(async (tx) => {
          const head = await tx.journal.head();
          await tx.deviceSettings.update((settings) => ({ ...settings, leftAccountAt: head }));
          await leave(tx, current.connection);
        });
      });
      await deps.janitor.drain();
      await scheduler.accountChanged();
    },
  };
}
