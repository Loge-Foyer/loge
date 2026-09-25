import {
  connectionId as toConnectionId,
  credentialsRef as toCredentialsRef,
  declaredRoles,
  type Connection,
  type ConnectionId,
  type ConnectionOwner,
  type ConnectionRoles,
  type Credentials,
  type FieldValue,
  type FieldValues,
  type PluginId,
  type PluginManifest,
  type UserId,
} from '@sc/api';

import type { DevicePlugins } from './device-plugins';
import { hasErrors, validateDraft, type FieldErrors } from './field-values';
import type { PluginCatalog } from './plugin-catalog';
import type { ConnectionRepository, IdGenerator, SecureCredentialStore } from './ports';

/** What the connection form submits. */
export interface ConnectionDraft {
  readonly label: string;
  readonly roles: ConnectionRoles;
  /** Non-secret connection-field values. */
  readonly fields: FieldValues;
  /** Password fields touched in this edit: a value replaces, `null` removes, absent keeps. */
  readonly secrets: Readonly<Record<string, string | null>>;
  readonly settings: FieldValues;
}

export class InvalidDraftError extends Error {
  readonly errors: FieldErrors;

  constructor(errors: FieldErrors) {
    super('The connection form has errors.');
    this.errors = errors;
  }
}

export interface ConnectionService {
  /** Where this plugin's connections live for this profile right now. */
  liveOwner(pluginId: PluginId, userId: UserId): Promise<ConnectionOwner>;
  list(owner: ConnectionOwner, pluginId: PluginId): Promise<readonly Connection[]>;
  get(id: ConnectionId): Promise<Connection | undefined>;
  /** Which password fields hold a saved value. Never the values themselves. */
  savedSecrets(id: ConnectionId): Promise<ReadonlySet<string>>;
  create(pluginId: PluginId, owner: ConnectionOwner, draft: ConnectionDraft): Promise<Connection>;
  update(id: ConnectionId, draft: ConnectionDraft): Promise<Connection>;
  remove(id: ConnectionId): Promise<void>;
}

export function createConnectionService(deps: {
  connections: ConnectionRepository;
  credentials: SecureCredentialStore;
  catalog: PluginCatalog;
  devicePlugins: DevicePlugins;
  ids: IdGenerator;
}): ConnectionService {
  const { connections, credentials, catalog, devicePlugins, ids } = deps;

  const manifestOf = (pluginId: PluginId) => {
    const manifest = catalog.get(pluginId);
    if (!manifest) throw new Error(`Plugin "${pluginId}" is not registered.`);
    return manifest;
  };

  const requireConnection = async (id: ConnectionId) => {
    const connection = await connections.get(id);
    if (!connection) throw new Error(`Unknown connection ${id}`);
    return connection;
  };

  const readSecrets = async (connection: Connection): Promise<Credentials> =>
    (connection.credentialsRef && (await credentials.read(connection.credentialsRef))) || {};

  /** Stores the merged secrets and returns the ref to keep on the connection, if any. */
  const storeSecrets = async (
    manifest: PluginManifest,
    current: Credentials,
    changes: ConnectionDraft['secrets'],
    ref: Connection['credentialsRef'],
  ) => {
    const merged: Record<string, string> = {};
    for (const field of manifest.connectionFields) {
      if (field.type !== 'password') continue;
      const change = changes[field.key];
      const value = change === undefined || change === '' ? current[field.key] : change;
      if (value !== null && value !== undefined) merged[field.key] = value;
    }
    if (Object.keys(merged).length === 0) {
      if (ref) await credentials.delete(ref);
      return undefined;
    }
    const kept = ref ?? toCredentialsRef(ids.next());
    await credentials.write(kept, merged);
    return kept;
  };

  /** Keeps only what the manifest declares, so nothing undeclared is ever stored. */
  const normalize = (manifest: PluginManifest, draft: ConnectionDraft) => {
    const pick = (keys: readonly string[], values: FieldValues) => {
      const picked: Record<string, FieldValue> = {};
      for (const key of keys) {
        const value = values[key];
        if (value !== undefined) picked[key] = typeof value === 'string' ? value.trim() : value;
      }
      return picked;
    };
    const roles: Partial<Record<'media' | 'sync', boolean>> = {};
    for (const role of declaredRoles(manifest)) roles[role] = draft.roles[role] === true;
    return {
      label: draft.label.trim(),
      roles,
      fields: pick(
        manifest.connectionFields.filter((field) => field.type !== 'password').map((field) => field.key),
        draft.fields,
      ),
      settings: pick(
        manifest.settings.map((setting) => setting.key),
        draft.settings,
      ),
    };
  };

  const assertValid = (manifest: PluginManifest, draft: ConnectionDraft, saved: ReadonlySet<string>) => {
    const errors = validateDraft(manifest, draft, saved);
    if (hasErrors(errors)) throw new InvalidDraftError(errors);
  };

  const savedSecrets = async (connection: Connection) => new Set(Object.keys(await readSecrets(connection)));

  return {
    liveOwner: async (pluginId, userId) =>
      (await devicePlugins.state(pluginId)).perProfile ? { scope: 'user', userId } : { scope: 'device' },
    list: async (owner, pluginId) =>
      (await connections.list(owner)).filter((connection) => connection.pluginId === pluginId),
    get: (id) => connections.get(id),
    savedSecrets: async (id) => savedSecrets(await requireConnection(id)),
    create: async (pluginId, owner, draft) => {
      const manifest = manifestOf(pluginId);
      assertValid(manifest, draft, new Set());
      const ref = await storeSecrets(manifest, {}, draft.secrets, undefined);
      const connection: Connection = {
        id: toConnectionId(ids.next()),
        owner,
        pluginId,
        ...normalize(manifest, draft),
        ...(ref ? { credentialsRef: ref } : {}),
      };
      await connections.insert(connection);
      return connection;
    },
    update: async (id, draft) => {
      const existing = await requireConnection(id);
      const manifest = manifestOf(existing.pluginId);
      assertValid(manifest, draft, await savedSecrets(existing));
      const ref = await storeSecrets(manifest, await readSecrets(existing), draft.secrets, existing.credentialsRef);
      const { credentialsRef: _previous, ...rest } = existing;
      const connection: Connection = {
        ...rest,
        ...normalize(manifest, draft),
        ...(ref ? { credentialsRef: ref } : {}),
      };
      await connections.update(connection);
      return connection;
    },
    remove: async (id) => {
      const connection = await connections.get(id);
      if (!connection) return;
      if (connection.credentialsRef) await credentials.delete(connection.credentialsRef);
      await connections.delete(id);
    },
  };
}
