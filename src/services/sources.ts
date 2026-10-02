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

import { watchStatusOf, type WatchStatusSetting } from './account-settings';
import type { PluginCatalog } from './plugin-catalog';
import type { AccountSettingsRepository, ConnectionRepository, ProfileValues } from './ports';
import { accountWide } from './scope';
import type { CredentialScope } from './sessions';
import { CONTENT_TABS, kindsForTab, type ContentTab } from './tab-content';

/**
 * Who keeps a source's watch status: the source itself — a media server, read
 * and written back through its outbox — or the app, on the account, where the
 * source keeps none and the account keeps it on a tab the source shows on.
 * Never both (spec §9).
 */
export type WatchKeeper = 'source' | 'app';

/** A connection that is live for a profile, with the values it runs with and what it may do. */
export interface Source {
  readonly connection: Connection;
  readonly manifest: PluginManifest;
  /** Whose credentials it signs in with. */
  readonly scope: CredentialScope;
  /** Shared values, with the profile's own where the connection keeps them per profile. */
  readonly values: ConnectionValues;
  readonly effective: EffectiveCapabilities;
  /** Who keeps what this profile watched on it — or nobody, and no badge says anything. */
  readonly watch?: WatchKeeper;
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

/**
 * The source keeps its own where it reads watch status for this profile;
 * otherwise the app does, where the account keeps it on a tab the source shows
 * films, series or videos on — never live channels, which nobody finishes.
 */
export function watchKeeperOf(
  manifest: PluginManifest,
  effective: EffectiveCapabilities,
  setting: WatchStatusSetting,
): WatchKeeper | undefined {
  if (!effective.media) return undefined;
  if (effective.media.capabilities.has('watchStateRead')) return 'source';
  const kinds = effective.media.contentKinds.filter((kind) => kind !== 'live');
  return CONTENT_TABS.some((tab) => setting[tab] && kindsForTab(tab, manifest.category, kinds).length > 0) ? 'app' : undefined;
}

export function createSourceService(deps: {
  catalog: PluginCatalog;
  connections: ConnectionRepository;
  /** Which tabs the account keeps watch status on. */
  accountSettings: Pick<AccountSettingsRepository, 'get'>;
}): SourceService {
  const { catalog, connections, accountSettings } = deps;

  const resolve = async (userId: UserId) => {
    const [all, own, stored] = await Promise.all([connections.list(), connections.valuesOfProfile(userId), accountSettings.get('watchStatus')]);
    const setting = watchStatusOf(stored?.value);
    const live: Source[] = [];
    const pending: PendingSource[] = [];
    // A plugin that does not run here is not in the catalogue: its connections wait on the devices it runs on.
    for (const manifest of catalog.list()) {
      // A source or an IPTV provider: what brings media, and nothing else of the account's.
      if (!accountWide(manifest.id) || !manifest.media) continue;
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
        const effective = effectiveCapabilities(manifest, { enabled: connection.enabled, settings: values.settings });
        const watch = watchKeeperOf(manifest, effective, setting);
        live.push({
          connection,
          manifest,
          scope: connection.perProfile === 'none' ? 'shared' : userId,
          values,
          effective,
          ...(watch ? { watch } : {}),
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
