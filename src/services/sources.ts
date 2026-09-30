import {
  effectiveCapabilities,
  isSetUpFor,
  resolveValues,
  type Connection,
  type ConnectionValues,
  type ContentKind,
  type EffectiveCapabilities,
  type PluginManifest,
  type UserId,
} from '@sc/api';

import type { PluginCatalog } from './plugin-catalog';
import type { ConnectionRepository, ProfileValues } from './ports';
import { accountWide } from './scope';
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
  readonly effective: EffectiveCapabilities;
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
  /** Every source and IPTV connection of the account that this profile can use, on this platform. */
  forUser(userId: UserId): Promise<readonly Source[]>;
  /** Sources whose effective media role brings something to `tab`. */
  forTab(userId: UserId, tab: ContentTab): Promise<readonly TabSource[]>;
  /** Media connections this profile still has to set up. The account is the device's, never a profile's to finish. */
  pendingFor(userId: UserId): Promise<readonly PendingSource[]>;
}

export function createSourceService(deps: { catalog: PluginCatalog; connections: ConnectionRepository }): SourceService {
  const { catalog, connections } = deps;

  const resolve = async (userId: UserId) => {
    const [all, own] = await Promise.all([connections.list(), connections.valuesOfProfile(userId)]);
    const live: Source[] = [];
    const pending: PendingSource[] = [];
    // A plugin that does not run here is not in the catalogue: its connections wait on the devices it runs on.
    for (const manifest of catalog.list()) {
      if (!accountWide(manifest.id)) continue;
      for (const connection of all) {
        // Switched off, a connection has nothing in effect, for anyone: it is no source, and nothing to finish.
        if (connection.pluginId !== manifest.id || !connection.enabled) continue;
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
          effective: effectiveCapabilities(manifest, { enabled: connection.enabled, settings: values.settings }),
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
        const kinds = kindsForTab(tab, source.manifest.category, source.effective.media?.contentKinds ?? []);
        if (kinds.length > 0) tabSources.push({ ...source, kinds });
      }
      return tabSources;
    },
    pendingFor: async (userId) => (await resolve(userId)).pending,
  };
}
