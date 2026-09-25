import {
  effectiveRoles,
  type Connection,
  type ContentKind,
  type EffectiveRoles,
  type PluginManifest,
  type UserId,
} from '@sc/api';

import type { DevicePlugins } from './device-plugins';
import type { PluginCatalog } from './plugin-catalog';
import type { ConnectionRepository } from './ports';
import { kindsForTab, type ContentTab } from './tab-content';

/** A connection that is live for a profile, with what it may actually do. */
export interface Source {
  readonly connection: Connection;
  readonly manifest: PluginManifest;
  readonly effective: EffectiveRoles;
}

export interface TabSource extends Source {
  /** The effective kinds this source brings to the tab, in the tab's order. */
  readonly kinds: readonly ContentKind[];
}

export interface SourceService {
  /**
   * For every plugin enabled on this device: its device connections, or the
   * profile's own when the plugin is configured per profile.
   */
  forUser(userId: UserId): Promise<readonly Source[]>;
  /** Sources whose effective media role brings something to `tab`. */
  forTab(userId: UserId, tab: ContentTab): Promise<readonly TabSource[]>;
}

export function createSourceService(deps: {
  catalog: PluginCatalog;
  devicePlugins: DevicePlugins;
  connections: ConnectionRepository;
}): SourceService {
  const { catalog, devicePlugins, connections } = deps;

  const forUser = async (userId: UserId) => {
    const [shared, own] = await Promise.all([
      connections.list({ scope: 'device' }),
      connections.list({ scope: 'user', userId }),
    ]);
    const sources: Source[] = [];
    for (const manifest of catalog.list()) {
      const state = await devicePlugins.state(manifest.id);
      if (!state.enabled) continue;
      for (const connection of state.perProfile ? own : shared) {
        if (connection.pluginId !== manifest.id) continue;
        sources.push({ connection, manifest, effective: effectiveRoles(manifest, connection) });
      }
    }
    return sources;
  };

  return {
    forUser,
    forTab: async (userId, tab) => {
      const tabSources: TabSource[] = [];
      for (const source of await forUser(userId)) {
        const kinds = kindsForTab(tab, source.effective.media?.contentKinds ?? []);
        if (kinds.length > 0) tabSources.push({ ...source, kinds });
      }
      return tabSources;
    },
  };
}
