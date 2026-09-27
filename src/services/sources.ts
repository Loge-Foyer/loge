import {
  effectiveRoles,
  isSetUpFor,
  resolveValues,
  type Connection,
  type ConnectionValues,
  type ContentKind,
  type EffectiveRoles,
  type PluginManifest,
  type UserId,
} from '@sc/api';

import { PLUGIN_OFF, type DevicePlugins } from './device-plugins';
import type { PluginCatalog } from './plugin-catalog';
import type { ConnectionRepository, ProfileValues } from './ports';
import type { CredentialScope } from './sessions';
import { kindsForTab, type ContentTab } from './tab-content';

/** A connection that is live for a profile, with the values it runs with and what it may do. */
export interface Source {
  readonly connection: Connection;
  readonly manifest: PluginManifest;
  /** Whose credentials it signs in with. */
  readonly scope: CredentialScope;
  /** Shared values, with the profile's own where the connection keeps them per profile. */
  readonly values: ConnectionValues;
  readonly effective: EffectiveRoles;
}

export interface TabSource extends Source {
  /** The effective kinds this source brings to the tab, in the tab's order. */
  readonly kinds: readonly ContentKind[];
}

/** A connection that keeps values per profile, which this profile has not filled in yet. */
export interface PendingSource {
  readonly connection: Connection;
  readonly manifest: PluginManifest;
}

/**
 * Where a connection stands for one profile: in use, waiting for the profile's
 * own values, or switched off for it. Off only exists where values are kept
 * per profile — a shared connection serves everyone.
 */
export type Standing = 'live' | 'pending' | 'off';

export function standingOf(
  manifest: PluginManifest,
  connection: Pick<Connection, 'perProfile'>,
  profile: ProfileValues | undefined,
): Standing {
  if (connection.perProfile !== 'none' && profile?.off === true) return 'off';
  return isSetUpFor(manifest, connection, profile) ? 'live' : 'pending';
}

export interface SourceService {
  /** Every connection of every plugin enabled on this device that this profile can use. */
  forUser(userId: UserId): Promise<readonly Source[]>;
  /** Sources whose effective media role brings something to `tab`. */
  forTab(userId: UserId, tab: ContentTab): Promise<readonly TabSource[]>;
  /** Connections this profile still has to set up. */
  pendingFor(userId: UserId): Promise<readonly PendingSource[]>;
}

export function createSourceService(deps: {
  catalog: PluginCatalog;
  devicePlugins: DevicePlugins;
  connections: ConnectionRepository;
}): SourceService {
  const { catalog, devicePlugins, connections } = deps;

  const resolve = async (userId: UserId) => {
    const [all, own, plugins] = await Promise.all([connections.list(), connections.valuesOfProfile(userId), devicePlugins.states()]);
    const live: Source[] = [];
    const pending: PendingSource[] = [];
    for (const manifest of catalog.list()) {
      if (!(plugins[manifest.id] ?? PLUGIN_OFF).enabled) continue;
      for (const connection of all) {
        if (connection.pluginId !== manifest.id) continue;
        const profile = own.get(connection.id);
        const standing = standingOf(manifest, connection, profile);
        if (standing === 'off') continue;
        if (standing === 'pending') {
          pending.push({ connection, manifest });
          continue;
        }
        const values = resolveValues(manifest, connection, profile);
        live.push({
          connection,
          manifest,
          scope: connection.perProfile === 'none' ? 'shared' : userId,
          values,
          effective: effectiveRoles(manifest, { roles: connection.roles, settings: values.settings }),
        });
      }
    }
    return { live, pending };
  };

  return {
    forUser: async (userId) => (await resolve(userId)).live,
    forTab: async (userId, tab) => {
      const tabSources: TabSource[] = [];
      for (const source of (await resolve(userId)).live) {
        const kinds = kindsForTab(tab, source.effective.media?.contentKinds ?? []);
        if (kinds.length > 0) tabSources.push({ ...source, kinds });
      }
      return tabSources;
    },
    pendingFor: async (userId) =>
      (await resolve(userId)).pending.filter(({ connection }) => connection.roles.media === true || connection.roles.sync === true),
  };
}
