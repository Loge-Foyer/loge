import {
  connectionId as toConnectionId,
  credentialsRef as toCredentialsRef,
  declaredRoles,
  perProfileKeys,
  type Connection,
  type ConnectionId,
  type ConnectionRoles,
  type ConnectionValues,
  type Credentials,
  type CredentialsRef,
  type FieldValue,
  type FieldValues,
  type PerProfile,
  type PluginId,
  type PluginManifest,
  type UserId,
} from '@sc/api';

import { hasErrors, validateDraft, type DraftErrors } from './field-values';
import type { PluginCatalog } from './plugin-catalog';
import type { ConnectionRepository, IdGenerator, ProfileValues, SecureCredentialStore, UserRepository } from './ports';
import type { Sessions } from './sessions';
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
  readonly roles: ConnectionRoles;
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
  edit(id: ConnectionId): Promise<ConnectionEditState | undefined>;
  create(pluginId: PluginId, draft: ConnectionDraft): Promise<Connection>;
  update(id: ConnectionId, draft: ConnectionDraft): Promise<Connection>;
  remove(id: ConnectionId): Promise<void>;
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
  connections: ConnectionRepository;
  users: UserRepository;
  credentials: SecureCredentialStore;
  catalog: PluginCatalog;
  sessions: Sessions;
  ids: IdGenerator;
  /** After a connection's values change or it goes: running providers let it go. */
  onChanged?: (id: ConnectionId) => void;
}): ConnectionService {
  const { connections, users, credentials, catalog, sessions, ids, onChanged } = deps;

  const manifestOf = (pluginId: PluginId) => {
    const manifest = catalog.get(pluginId);
    if (!manifest) throw new Error(`Plugin "${pluginId}" is not registered.`);
    return manifest;
  };

  const secretsAt = async (ref: CredentialsRef | undefined): Promise<Credentials> =>
    (ref && (await credentials.read(ref))) || {};

  const savedIn = (stored: Stored, scope: SecretScope) =>
    secretsAt(scope === 'shared' ? stored.connection?.values.credentialsRef : stored.profiles.get(scope)?.credentialsRef);

  const nextSecrets = async (
    keys: readonly string[],
    changes: ValuesDraft['secrets'],
    current: Credentials,
    stored: Stored,
  ): Promise<Record<string, string>> => {
    const next: Record<string, string> = {};
    for (const key of keys) {
      const change = changes[key];
      if (change === null) continue;
      const value =
        typeof change === 'object'
          ? (await savedIn(stored, change.adopt))[key]
          : change === undefined || change === ''
            ? current[key]
            : change;
      if (value !== undefined) next[key] = value;
    }
    return next;
  };

  // A changed secret always gets a new ref. Rows point at it once they are
  // saved, and only then does the old one go: a crash in between can leave an
  // orphaned secret, never a row pointing at nothing.
  const storeSecrets = async (
    next: Record<string, string>,
    current: Credentials,
    ref: CredentialsRef | undefined,
  ): Promise<{ ref?: CredentialsRef; stale?: CredentialsRef }> => {
    if (Object.keys(next).length === 0) return ref ? { stale: ref } : {};
    if (ref && sameSecrets(next, current)) return { ref };
    const fresh = toCredentialsRef(ids.next());
    await credentials.write(fresh, next);
    return { ref: fresh, ...(ref ? { stale: ref } : {}) };
  };

  const save = async (pluginId: PluginId, draft: ConnectionDraft, existing: Connection | undefined) => {
    const manifest = manifestOf(pluginId);
    const storedProfiles = existing ? await connections.profileValues(existing.id) : new Map<UserId, ProfileValues>();
    const stored: Stored = { ...(existing ? { connection: existing } : {}), profiles: storedProfiles };
    const errors = validateDraft(manifest, draft, savedSecretsOf(existing, storedProfiles));
    if (hasErrors(errors)) throw new InvalidDraftError(errors);

    const keys = perProfileKeys(manifest, draft.perProfile);
    const passwords = manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key);
    const plainFields = manifest.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key);
    const settingKeys = manifest.settings.map((setting) => setting.key);
    // Every password is a credential, so any split keeps all of them per profile.
    const separate = draft.perProfile !== 'none';
    const stale: CredentialsRef[] = [];

    const sharedCurrent = await secretsAt(existing?.values.credentialsRef);
    const sharedNext = await nextSecrets(separate ? [] : passwords, draft.shared.secrets, sharedCurrent, stored);
    const sharedRef = await storeSecrets(sharedNext, sharedCurrent, existing?.values.credentialsRef);
    if (sharedRef.stale) stale.push(sharedRef.stale);

    const id = existing?.id ?? toConnectionId(ids.next());
    const connection: Connection = {
      id,
      pluginId,
      label: draft.label.trim(),
      roles: rolesOf(manifest, draft.roles),
      perProfile: draft.perProfile,
      values: {
        fields: pick(plainFields.filter((key) => !keys.fields.has(key)), draft.shared.fields),
        settings: pick(settingKeys.filter((key) => !keys.settings.has(key)), draft.shared.settings),
        ...(sharedRef.ref ? { credentialsRef: sharedRef.ref, secretKeys: Object.keys(sharedNext) } : {}),
      },
    };
    if (existing) await connections.update(connection);
    else await connections.insert(connection);

    const knownUsers = new Set((await users.list()).map((user) => user.id));
    const touched = new Set<UserId>([...storedProfiles.keys(), ...(Object.keys(draft.profiles) as UserId[])]);
    const kept = new Set<UserId>();
    for (const userId of touched) {
      const row = storedProfiles.get(userId);
      const values: ProfileDraft | undefined =
        draft.profiles[userId] ??
        (row ? { fields: row.fields, settings: row.settings, secrets: {}, ...(row.off ? { off: true as const } : {}) } : undefined);
      if (separate && knownUsers.has(userId) && values?.off) {
        // Switched off: the row says so and holds nothing else.
        await connections.putProfileValues(id, userId, { fields: {}, settings: {}, off: true });
        if (row?.credentialsRef) stale.push(row.credentialsRef);
        continue;
      }
      const current = await secretsAt(row?.credentialsRef);
      const secrets = separate && values ? await nextSecrets(passwords, values.secrets, current, stored) : {};
      const fields = values ? pick(plainFields.filter((key) => keys.fields.has(key)), values.fields) : {};
      const settings = values ? pick(settingKeys.filter((key) => keys.settings.has(key)), values.settings) : {};
      const empty = Object.keys(fields).length + Object.keys(settings).length + Object.keys(secrets).length === 0;
      if (!separate || !knownUsers.has(userId) || empty) {
        // Nothing of its own left: the profile is simply not set up.
        if (row) {
          await connections.deleteProfileValues(id, userId);
          if (row.credentialsRef) stale.push(row.credentialsRef);
        }
        continue;
      }
      const ref = await storeSecrets(secrets, current, row?.credentialsRef);
      if (ref.stale) stale.push(ref.stale);
      await connections.putProfileValues(id, userId, {
        fields,
        settings,
        ...(ref.ref ? { credentialsRef: ref.ref, secretKeys: Object.keys(secrets) } : {}),
      });
      kept.add(userId);
    }

    for (const ref of stale) await credentials.delete(ref);
    // Sessions of scopes this connection no longer signs in with.
    if (separate) await sessions.forget(id, 'shared');
    for (const userId of knownUsers) if (!kept.has(userId)) await sessions.forget(id, userId);
    onChanged?.(id);
    return connection;
  };

  return {
    list: async (pluginId) => {
      const manifest = catalog.get(pluginId);
      if (!manifest) return [];
      const userIds = (await users.list()).map((user) => user.id);
      const own = (await connections.list()).filter((connection) => connection.pluginId === pluginId);
      return Promise.all(
        own.map(async (connection) => {
          const profiles = await connections.profileValues(connection.id);
          const standing = (userId: UserId) => standingOf(manifest, connection, profiles.get(userId));
          return {
            connection,
            setUp: new Set(userIds.filter((userId) => standing(userId) === 'live')),
            off: new Set(userIds.filter((userId) => standing(userId) === 'off')),
          };
        }),
      );
    },
    edit: async (id) => {
      const connection = await connections.get(id);
      if (!connection) return undefined;
      const profileValues = await connections.profileValues(id);
      return { connection, profileValues, saved: savedSecretsOf(connection, profileValues) };
    },
    create: (pluginId, draft) => save(pluginId, draft, undefined),
    update: async (id, draft) => {
      const existing = await connections.get(id);
      if (!existing) throw new Error(`Unknown connection ${id}`);
      return save(existing.pluginId, draft, existing);
    },
    remove: async (id) => {
      const connection = await connections.get(id);
      if (!connection) return;
      const profiles = await connections.profileValues(id);
      // Secrets are not in the database, so its cascade cannot reach them.
      for (const ref of [connection.values.credentialsRef, ...[...profiles.values()].map((values) => values.credentialsRef)]) {
        if (ref) await credentials.delete(ref);
      }
      await sessions.forget(id, 'shared');
      for (const user of await users.list()) await sessions.forget(id, user.id);
      onChanged?.(id);
      await connections.delete(id);
    },
    probeSecrets: async (pluginId, id, scope, changes) => {
      const manifest = manifestOf(pluginId);
      const existing = id ? await connections.get(id) : undefined;
      const stored: Stored = {
        ...(existing ? { connection: existing } : {}),
        profiles: existing ? await connections.profileValues(existing.id) : new Map(),
      };
      const passwords = manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key);
      return nextSecrets(passwords, changes, await savedIn(stored, scope), stored);
    },
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

function rolesOf(manifest: PluginManifest, roles: ConnectionRoles): ConnectionRoles {
  const next: Partial<Record<'media' | 'sync', boolean>> = {};
  for (const role of declaredRoles(manifest)) next[role] = roles[role] === true;
  return next;
}

function sameSecrets(a: Credentials, b: Credentials): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
