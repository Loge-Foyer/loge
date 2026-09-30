import type { PlatformId, PlayerCandidate, PluginId, PluginManifest } from '@sc/api';

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
/** What `choosePlayer` takes on this device: the players that can play here, in order, and the one to try first. */
export interface PlayerChoice {
  readonly candidates: readonly PlayerCandidate[];
  readonly preferred?: PluginId;
}

export interface PlayerService {
  list(): Promise<readonly PlayerSummary[]>;
  /** The enabled players with a profile for this platform, in the catalogue's order — never by name. */
  choosing(): Promise<PlayerChoice>;
  setEnabled(id: PluginId, enabled: boolean): Promise<void>;
  /** Also switches it on: a player that plays first is on. */
  setPreferred(id: PluginId): Promise<void>;
}

export function createPlayerService(deps: {
  readonly catalog: PluginCatalog;
  readonly deviceSettings: DeviceSettingsRepository;
  readonly platform: PlatformId;
}): PlayerService {
  const { catalog, deviceSettings, platform } = deps;
  const players = () => catalog.inCategory('players');

  const standing = async () => {
    const settings = (await deviceSettings.get()).players ?? {};
    const off = new Set(settings.off ?? []);
    const enabled = players().filter((manifest) => !off.has(manifest.id));
    // The chosen one while it is on; otherwise the first that is — in the catalogue's order, never by name.
    const preferred = enabled.find((manifest) => manifest.id === settings.preferred) ?? enabled[0];
    return { off, enabled, preferred };
  };

  return {
    list: async () => {
      const { off, preferred } = await standing();
      return players().map((manifest) => ({ manifest, enabled: !off.has(manifest.id), preferred: manifest.id === preferred?.id }));
    },
    choosing: async () => {
      const { enabled, preferred } = await standing();
      const candidates = enabled.flatMap((manifest) => {
        const profile = manifest.player?.profiles[platform];
        return profile ? [{ id: manifest.id, profile }] : [];
      });
      // A player with no engine here states no profile, so it never plays first.
      const first = candidates.find((candidate) => candidate.id === preferred?.id);
      return { candidates, ...(first ? { preferred: first.id } : {}) };
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
