import {
  AppError,
  connectionId as toConnectionId,
  credentialsRef as toCredentialsRef,
  perProfileKeys,
  type Connection,
  type ConnectionId,
  type ConnectionValues,
  type Credentials,
  type CredentialsRef,
  type FieldValue,
  type FieldValues,
  type PerProfile,
  type PluginId,
  type UserId,
} from '@sc/api';

import { hasErrors, validateDraft, type DraftErrors } from './field-values';
import { stableJson } from './hash';
import type { PluginCatalog } from './plugin-catalog';
import type { IdGenerator, LocalDatabase, ProfileValues, Repositories, SecureCredentialStore } from './ports';
import { removeConnectionIn } from './removal';
import { accountWide } from './scope';
import type { SecretJanitor } from './secrets';
import { sessionRef, type CredentialScope } from './sessions';
import { standingOf } from './sources';

export type SecretScope = 'shared' | UserId;

/**
 * A password as edited: a new value, `null` to remove it, or the saved value
 * of another scope — moved over without ever being shown.
 */
export type SecretChange = string | null | { readonly adopt: SecretScope };

export interface ValuesDraft {
  readonly fields: FieldValues;
  readonly settings: FieldValues;
  /** Password fields touched in this edit. A key left out keeps what is saved, and so does `''`. */
  readonly secrets: Readonly<Record<string, SecretChange>>;
}

/** One profile's own values as edited. */
export interface ProfileDraft extends ValuesDraft {
  /** Switched off for this profile. What was typed stays in the draft, so switching back on restores it, but none of it is saved. */
  readonly off?: true;
}

/** What the connection form submits. */
export interface ConnectionDraft {
  readonly label: string;
  /** Switched off, it stays configured and nothing of it is used — on any device of the account. */
  readonly enabled: boolean;
  readonly perProfile: PerProfile;
  readonly shared: ValuesDraft;
  /** A profile left out keeps what it has stored. */
  readonly profiles: Readonly<Partial<Record<UserId, ProfileDraft>>>;
}

/** Which password fields hold a saved value, per scope — never the values. */
export interface SavedSecrets {
  readonly shared: ReadonlySet<string>;
  readonly profiles: ReadonlyMap<UserId, ReadonlySet<string>>;
}

export interface ConnectionEditState {
  readonly connection: Connection;
  readonly profileValues: ReadonlyMap<UserId, ProfileValues>;
  readonly saved: SavedSecrets;
}

export interface ConnectionSummary {
  readonly connection: Connection;
  /** The device's account reaches its server through it, and only the account service changes that. */
  readonly isAccount: boolean;
  /** The profiles it is live for: every profile when nothing is kept per profile. */
  readonly setUp: ReadonlySet<UserId>;
  /** The profiles it is switched off for. */
  readonly off: ReadonlySet<UserId>;
}

export class InvalidDraftError extends Error {
  readonly errors: DraftErrors;

  constructor(errors: DraftErrors) {
    super('The connection form has errors.');
    this.errors = errors;
  }
}

export interface ConnectionService {
  list(pluginId: PluginId): Promise<readonly ConnectionSummary[]>;
  /** The plugins with at least one connection, for the lists in Settings → Adapters. */
  connected(): Promise<ReadonlySet<PluginId>>;
  edit(id: ConnectionId): Promise<ConnectionEditState | undefined>;
  create(pluginId: PluginId, draft: ConnectionDraft): Promise<Connection>;
  update(id: ConnectionId, draft: ConnectionDraft): Promise<Connection>;
  /** The account's connection is refused: signing out comes first. */
  remove(id: ConnectionId): Promise<void>;
  /**
   * What the password fields a manifest marks `visible` hold for `scope` — a
   * portal's MAC address — for the form to show. Never any other password.
   */
  visibleSecrets(id: ConnectionId, scope: SecretScope): Promise<Credentials>;
  /**
   * The secret values a probe signs in with: what `scope` has saved, with this
   * edit's changes applied. They go to the plugin, never to a screen.
   */
  probeSecrets(
    pluginId: PluginId,
    id: ConnectionId | undefined,
    scope: SecretScope,
    changes: ValuesDraft['secrets'],
  ): Promise<Credentials>;
  /**
   * A save, in the three steps every save takes, for a caller that commits it
   * inside a transaction of its own — the account service, which writes its
   * connection together with everything a sign-in writes.
   */
  plan(pluginId: PluginId, draft: ConnectionDraft, existing: Connection | undefined): Promise<SavePlan>;
  commit(tx: Repositories, plan: SavePlan): Promise<void>;
  /** After a commit that failed: the secrets the plan wrote are pointed at by nothing. */
  discard(plan: SavePlan): Promise<void>;
}

/** A save worked out from what is stored, with its fresh secrets already written. */
export interface SavePlan {
  readonly connection: Connection;
  readonly existing?: Connection;
  readonly storedProfiles: ReadonlyMap<UserId, ProfileValues>;
  readonly knownUsers: readonly UserId[];
  /** Each profile's row as it should be: values to put, or `null` to delete it. */
  readonly rows: ReadonlyMap<UserId, ProfileValues | null>;
  /** Refs the rows stop pointing at, queued in the commit. */
  readonly stale: readonly CredentialsRef[];
  /** Refs written for this save, pointed at by nothing until it commits. */
  readonly fresh: readonly CredentialsRef[];
  /** The sessions of every scope the connection no longer signs in with. */
  readonly signedOut: readonly CredentialScope[];
}

interface Stored {
  readonly connection?: Connection;
  readonly profiles: ReadonlyMap<UserId, ProfileValues>;
}

export function savedSecretsOf(connection: Connection | undefined, profiles: ReadonlyMap<UserId, ConnectionValues>): SavedSecrets {
  return {
    shared: new Set(connection?.values.secretKeys ?? []),
    profiles: new Map([...profiles].map(([userId, values]) => [userId, new Set(values.secretKeys ?? [])])),
  };
}

export function createConnectionService(deps: {
  db: LocalDatabase;
  credentials: SecureCredentialStore;
  catalog: PluginCatalog;
  janitor: SecretJanitor;
  ids: IdGenerator;
  /** After a connection's values change or it goes: running providers let it go. */
  onChanged?: (id: ConnectionId) => void;
}): ConnectionService {
  const { db, credentials, catalog, janitor, ids, onChanged } = deps;

  const manifestOf = (pluginId: PluginId) => {
    const manifest = catalog.get(pluginId);
    if (!manifest) throw new Error(`Adapter "${pluginId}" is not available on this device.`);
    return manifest;
  };

  const secretsAt = async (ref: CredentialsRef | undefined): Promise<Credentials> =>
    (ref && (await credentials.read(ref))) || {};

  const savedIn = (stored: Stored, scope: SecretScope) =>
    secretsAt(scope === 'shared' ? stored.connection?.values.credentialsRef : stored.profiles.get(scope)?.credentialsRef);

  /**
   * What a scope's password fields hold after this edit. A password the row
   * lists but this device does not have — saved on another device, or lost
   * with a restore — stays listed while the edit leaves it alone: it is still
   * saved, so the connection asks for it rather than signing in without it.
   * Only a removal (`null`) takes it off the list.
   */
  const nextSecrets = async (
    keys: readonly string[],
    changes: ValuesDraft['secrets'],
    current: Credentials,
    listed: readonly string[],
    stored: Stored,
  ): Promise<{ readonly values: Record<string, string>; readonly keys: readonly string[] }> => {
    const values: Record<string, string> = {};
    const kept: string[] = [];
    for (const key of keys) {
      const change = changes[key];
      if (change === null) continue;
      const untouched = change === undefined || change === '';
      const value =
        typeof change === 'object' ? (await savedIn(stored, change.adopt))[key] : untouched ? current[key] : change;
      if (value !== undefined) {
        values[key] = value;
        kept.push(key);
      } else if (untouched && listed.includes(key)) {
        kept.push(key);
      }
    }
    return { values, keys: kept };
  };

  /** The password fields whose saved value is on this device: a row can list one it does not have. */
  const presentSecrets = async (values: ConnectionValues | undefined): Promise<ReadonlySet<string>> => {
    const keys = values?.secretKeys ?? [];
    if (keys.length === 0) return new Set();
    const saved = await secretsAt(values?.credentialsRef);
    return new Set(keys.filter((key) => saved[key] !== undefined));
  };

  // A save takes three steps. First the plan, read from what is stored, with
  // any changed secret written under a fresh ref that nothing points at yet.
  // Then one transaction for the rows, which also queues the refs they no
  // longer point at. Last, those are deleted. A crash leaves at worst an
  // orphaned secret, never a row pointing at nothing — and no await but the
  // database's own happens inside the transaction.
  const plan = async (pluginId: PluginId, draft: ConnectionDraft, existing: Connection | undefined): Promise<SavePlan> => {
    const manifest = manifestOf(pluginId);
    const storedProfiles = existing ? await db.connections.profileValues(existing.id) : new Map<UserId, ProfileValues>();
    const stored: Stored = { ...(existing ? { connection: existing } : {}), profiles: storedProfiles };
    const errors = validateDraft(manifest, draft, savedSecretsOf(existing, storedProfiles));
    if (hasErrors(errors)) throw new InvalidDraftError(errors);
    // A sync plugin's connection is the device's: there is nothing of a profile's in it.
    if (!accountWide(pluginId) && draft.perProfile !== 'none') {
      throw new InvalidDraftError({ shared: {}, profiles: {}, form: 'This belongs to the device, so it keeps nothing per profile.' });
    }

    const keys = perProfileKeys(manifest, draft.perProfile);
    const passwords = manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key);
    const plainFields = manifest.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key);
    const settingKeys = manifest.settings.map((setting) => setting.key);
    // Every password is a credential, so any split keeps all of them per profile.
    const separate = draft.perProfile !== 'none';
    const knownUsers = (await db.users.list()).map((user) => user.id);
    const id = existing?.id ?? toConnectionId(ids.next());

    const fresh: CredentialsRef[] = [];
    const stale: CredentialsRef[] = [];
    // A changed secret always gets a new ref; the old one is stale once the rows commit.
    const storeSecrets = async (next: Record<string, string>, current: Credentials, ref: CredentialsRef | undefined) => {
      if (Object.keys(next).length === 0) {
        if (ref) stale.push(ref);
        return undefined;
      }
      if (ref && sameSecrets(next, current)) return ref;
      const created = toCredentialsRef(ids.next());
      fresh.push(created);
      await credentials.write(created, next);
      if (ref) stale.push(ref);
      return created;
    };
    const valuesOf = (ref: CredentialsRef | undefined, secretKeys: readonly string[]) => ({
      ...(ref ? { credentialsRef: ref } : {}),
      ...(secretKeys.length > 0 ? { secretKeys } : {}),
    });

    try {
      const sharedCurrent = await secretsAt(existing?.values.credentialsRef);
      const shared = await nextSecrets(
        separate ? [] : passwords,
        draft.shared.secrets,
        sharedCurrent,
        existing?.values.secretKeys ?? [],
        stored,
      );
      const sharedRef = await storeSecrets(shared.values, sharedCurrent, existing?.values.credentialsRef);
      const connection: Connection = {
        id,
        pluginId,
        label: draft.label.trim(),
        enabled: draft.enabled,
        perProfile: draft.perProfile,
        values: {
          fields: pick(plainFields.filter((key) => !keys.fields.has(key)), draft.shared.fields),
          settings: pick(settingKeys.filter((key) => !keys.settings.has(key)), draft.shared.settings),
          ...valuesOf(sharedRef, shared.keys),
        },
      };

      const rows = new Map<UserId, ProfileValues | null>();
      const touched = new Set<UserId>([...storedProfiles.keys(), ...(Object.keys(draft.profiles) as UserId[])]);
      for (const userId of touched) {
        const row = storedProfiles.get(userId);
        const values: ProfileDraft | undefined =
          draft.profiles[userId] ??
          (row ? { fields: row.fields, settings: row.settings, secrets: {}, ...(row.off ? { off: true as const } : {}) } : undefined);
        if (separate && knownUsers.includes(userId) && values?.off) {
          // Switched off: the row says so and holds nothing else.
          rows.set(userId, { fields: {}, settings: {}, off: true });
          if (row?.credentialsRef) stale.push(row.credentialsRef);
          continue;
        }
        const current = await secretsAt(row?.credentialsRef);
        const secrets =
          separate && values ? await nextSecrets(passwords, values.secrets, current, row?.secretKeys ?? [], stored) : { values: {}, keys: [] };
        const fields = values ? pick(plainFields.filter((key) => keys.fields.has(key)), values.fields) : {};
        const settings = values ? pick(settingKeys.filter((key) => keys.settings.has(key)), values.settings) : {};
        const empty = Object.keys(fields).length + Object.keys(settings).length + secrets.keys.length === 0;
        if (!separate || !knownUsers.includes(userId) || empty) {
          // Nothing of its own left: the profile is simply not set up.
          if (row) {
            rows.set(userId, null);
            if (row.credentialsRef) stale.push(row.credentialsRef);
          }
          continue;
        }
        const ref = await storeSecrets(secrets.values, current, row?.credentialsRef);
        rows.set(userId, { fields, settings, ...valuesOf(ref, secrets.keys) });
      }

      const signingIn = new Set([...rows].filter(([, row]) => row !== null && !row.off).map(([userId]) => userId));
      const signedOut: CredentialScope[] = [
        ...(separate ? (['shared'] as const) : []),
        ...knownUsers.filter((userId) => !signingIn.has(userId)),
      ];
      return {
        connection,
        ...(existing ? { existing } : {}),
        storedProfiles,
        knownUsers,
        rows,
        stale,
        fresh,
        signedOut,
      };
    } catch (error) {
      for (const ref of fresh) await credentials.delete(ref).catch(() => undefined);
      throw error;
    }
  };

  const commit = async (tx: Repositories, planned: SavePlan) => {
    const { connection, existing, storedProfiles, knownUsers, rows, stale, signedOut } = planned;
    // The plan was made from what was stored; if that changed meanwhile — another tab, a profile removed — it no longer holds.
    const now = existing ? await tx.connections.get(existing.id) : undefined;
    const profilesNow = existing ? await tx.connections.profileValues(existing.id) : new Map<UserId, ProfileValues>();
    const usersNow = (await tx.users.list()).map((user) => user.id);
    if (
      stableJson(now) !== stableJson(existing) ||
      stableJson([...profilesNow]) !== stableJson([...storedProfiles]) ||
      stableJson(usersNow) !== stableJson(knownUsers)
    ) {
      throw new AppError('INVALID_STATE', 'This connection changed while it was being saved. Try again.', { retry: 'never' });
    }
    if (existing) await tx.connections.update(connection);
    else await tx.connections.insert(connection);
    for (const [userId, row] of rows) {
      if (row) await tx.connections.putProfileValues(connection.id, userId, row);
      else await tx.connections.deleteProfileValues(connection.id, userId);
    }
    // What the source answered under the old values may not hold under the new ones.
    await tx.mediaCache.purge(connection.id);
    await tx.staleSecrets.add([...stale, ...signedOut.map((scope) => sessionRef(connection.id, scope))]);
  };

  const discard = async (planned: SavePlan) => {
    for (const ref of planned.fresh) await credentials.delete(ref).catch(() => undefined);
  };

  const save = async (pluginId: PluginId, draft: ConnectionDraft, existing: Connection | undefined) => {
    const planned = await plan(pluginId, draft, existing);
    try {
      await db.transaction((tx) => commit(tx, planned));
    } catch (error) {
      // Nothing points at what this save wrote: take it back.
      await discard(planned);
      throw error;
    }
    await janitor.drain();
    onChanged?.(planned.connection.id);
    return planned.connection;
  };

  return {
    list: async (pluginId) => {
      const manifest = catalog.get(pluginId);
      if (!manifest) return [];
      const userIds = (await db.users.list()).map((user) => user.id);
      const account = await db.account.get();
      const own = (await db.connections.list()).filter((connection) => connection.pluginId === pluginId);
      return Promise.all(
        own.map(async (connection) => {
          const profiles = await db.connections.profileValues(connection.id);
          const standing = (userId: UserId) => standingOf(manifest, connection, profiles.get(userId));
          return {
            connection,
            isAccount: account?.kind === 'server' && account.connectionId === connection.id,
            setUp: new Set(userIds.filter((userId) => standing(userId) === 'live')),
            off: new Set(userIds.filter((userId) => standing(userId) === 'off')),
          };
        }),
      );
    },
    connected: async () => new Set((await db.connections.list()).map((connection) => connection.pluginId)),
    edit: async (id) => {
      const connection = await db.connections.get(id);
      if (!connection) return undefined;
      const profileValues = await db.connections.profileValues(id);
      const profiles = new Map<UserId, ReadonlySet<string>>();
      for (const [userId, values] of profileValues) profiles.set(userId, await presentSecrets(values));
      return { connection, profileValues, saved: { shared: await presentSecrets(connection.values), profiles } };
    },
    create: (pluginId, draft) => save(pluginId, draft, undefined),
    update: async (id, draft) => {
      const existing = await db.connections.get(id);
      if (!existing) throw new Error(`Unknown connection ${id}`);
      return save(existing.pluginId, draft, existing);
    },
    remove: async (id) => {
      const removed = await db.transaction(async (tx) => {
        const account = await tx.account.get();
        if (account?.kind === 'server' && account.connectionId === id) {
          throw new AppError('INVALID_STATE', 'This connection is your account. Sign out of it first.', { retry: 'never' });
        }
        return removeConnectionIn(tx, id);
      });
      if (!removed) return;
      await janitor.drain();
      onChanged?.(id);
    },
    visibleSecrets: async (id, scope) => {
      const existing = await db.connections.get(id);
      const manifest = existing ? catalog.get(existing.pluginId) : undefined;
      const shown = (manifest?.connectionFields ?? []).filter((field) => field.type === 'password' && field.visible === true).map((field) => field.key);
      if (!existing || shown.length === 0) return {};
      const saved = await savedIn({ connection: existing, profiles: await db.connections.profileValues(id) }, scope);
      return Object.fromEntries(shown.flatMap((key) => (saved[key] === undefined ? [] : [[key, saved[key]]])));
    },
    probeSecrets: async (pluginId, id, scope, changes) => {
      const manifest = manifestOf(pluginId);
      const existing = id ? await db.connections.get(id) : undefined;
      const stored: Stored = {
        ...(existing ? { connection: existing } : {}),
        profiles: existing ? await db.connections.profileValues(existing.id) : new Map(),
      };
      const passwords = manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key);
      return (await nextSecrets(passwords, changes, await savedIn(stored, scope), [], stored)).values;
    },
    plan,
    commit,
    discard,
  };
}

/** Keeps only what the manifest declares, so nothing undeclared is ever stored. */
function pick(keys: readonly string[], values: FieldValues): Record<string, FieldValue> {
  const picked: Record<string, FieldValue> = {};
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined) picked[key] = typeof value === 'string' ? value.trim() : value;
  }
  return picked;
}

function sameSecrets(a: Credentials, b: Credentials): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
