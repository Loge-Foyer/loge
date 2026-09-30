import type { PluginId, PluginManifest } from '@sc/api';

import type { PluginCatalog } from './plugin-catalog';
import type { DeviceSettingsRepository } from './ports';

export interface PlayerSummary {
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  /** The one that plays first, when it can play what is asked. */
  readonly preferred: boolean;
}

/**
 * This device's players — the ones on this platform — and which plays first.
 * Players belong to the device: another device chooses its own, and nothing
 * of this is journaled, carried to your server or written into a backup.
 * Which player plays an item is `choosePlayer` in `@sc/api`, over this.
 */
export interface PlayerService {
  list(): Promise<readonly PlayerSummary[]>;
  setEnabled(id: PluginId, enabled: boolean): Promise<void>;
  /** Also switches it on: a player that plays first is on. */
  setPreferred(id: PluginId): Promise<void>;
}

export function createPlayerService(deps: { readonly catalog: PluginCatalog; readonly deviceSettings: DeviceSettingsRepository }): PlayerService {
  const { catalog, deviceSettings } = deps;
  const players = () => catalog.inCategory('players');

  return {
    list: async () => {
      const settings = (await deviceSettings.get()).players ?? {};
      const off = new Set(settings.off ?? []);
      const enabled = players().filter((manifest) => !off.has(manifest.id));
      // The chosen one while it is on; otherwise the first that is — in the catalogue's order, never by name.
      const preferred = enabled.find((manifest) => manifest.id === settings.preferred) ?? enabled[0];
      return players().map((manifest) => ({ manifest, enabled: !off.has(manifest.id), preferred: manifest.id === preferred?.id }));
    },
    setEnabled: async (id, enabled) => {
      await deviceSettings.update((current) => {
        const off = new Set(current.players?.off ?? []);
        if (enabled) off.delete(id);
        else off.add(id);
        return { ...current, players: { ...current.players, off: [...off] } };
      });
    },
    setPreferred: async (id) => {
      await deviceSettings.update((current) => ({
        ...current,
        players: { off: (current.players?.off ?? []).filter((other) => other !== id), preferred: id },
      }));
    },
  };
}
