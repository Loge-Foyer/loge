import type { PlatformId, PlayerCandidate, PluginId, PluginManifest } from '@sc/api';

import type { PluginCatalog } from './plugin-catalog';
import type { DeviceSettingsRepository } from './ports';
import { CONTENT_TABS, type ContentTab } from './tab-content';

export interface PlayerSummary {
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  /** The one that plays first, when it can play what is asked. */
  readonly preferred: boolean;
  /** The tabs it plays first on, before the device's first — while it is on. */
  readonly firstOn: readonly ContentTab[];
  /** It has an engine on this platform: a profile for it. One without never plays. */
  readonly playsHere: boolean;
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
  /**
   * The enabled players with a profile for this platform, in the catalogue's
   * order — never by name — and the one to try first: the tab's own, when it
   * has one that is on, else the device's.
   */
  choosing(tab?: ContentTab): Promise<PlayerChoice>;
  setEnabled(id: PluginId, enabled: boolean): Promise<void>;
  /** Also switches it on: a player that plays first is on. */
  setPreferred(id: PluginId): Promise<void>;
  /** Makes it, or stops it being, the one that plays first on a tab. Making it switches it on. */
  setFirstOn(id: PluginId, tab: ContentTab, first: boolean): Promise<void>;
  /**
   * Moves it one place up (`-1`) or down (`1`) in this device's order, which
   * is the order they are listed and tried in. At either end, nothing happens.
   */
  move(id: PluginId, by: -1 | 1): Promise<void>;
}

export function createPlayerService(deps: {
  readonly catalog: PluginCatalog;
  readonly deviceSettings: DeviceSettingsRepository;
  readonly platform: PlatformId;
}): PlayerService {
  const { catalog, deviceSettings, platform } = deps;

  /**
   * This device's order: the ones it names, in that order, then everything
   * else in the catalogue's. A player an update adds therefore appears at the
   * end rather than vanishing, and no stored id is ever required to exist.
   */
  const players = (order?: readonly PluginId[]) => {
    const all = catalog.inCategory('players');
    if (!order || order.length === 0) return all;
    const rest = new Map(all.map((manifest) => [manifest.id, manifest]));
    const named = order.flatMap((id) => {
      const manifest = rest.get(id);
      if (!manifest) return [];
      rest.delete(id);
      return [manifest];
    });
    return [...named, ...rest.values()];
  };

  const standing = async () => {
    const settings = (await deviceSettings.get()).players ?? {};
    const off = new Set(settings.off ?? []);
    const listed = players(settings.order);
    const enabled = listed.filter((manifest) => !off.has(manifest.id));
    // The chosen one while it is on; otherwise the first that is — in this device's order, never by name.
    const preferred = enabled.find((manifest) => manifest.id === settings.preferred) ?? enabled[0];
    return { off, listed, enabled, preferred, tabs: settings.tabs ?? {} };
  };

  return {
    list: async () => {
      const { off, listed, preferred, tabs } = await standing();
      return listed.map((manifest) => ({
        manifest,
        enabled: !off.has(manifest.id),
        preferred: manifest.id === preferred?.id,
        firstOn: off.has(manifest.id) ? [] : CONTENT_TABS.filter((tab) => tabs[tab] === manifest.id),
        playsHere: manifest.player?.profiles[platform] !== undefined,
      }));
    },
    choosing: async (tab) => {
      const { enabled, preferred, tabs } = await standing();
      const candidates = enabled.flatMap((manifest) => {
        const profile = manifest.player?.profiles[platform];
        return profile ? [{ id: manifest.id, profile }] : [];
      });
      // A player with no engine here states no profile, so it never plays first — on a tab or anywhere.
      const onTab = tab === undefined ? undefined : candidates.find((candidate) => candidate.id === tabs[tab]);
      const first = onTab ?? candidates.find((candidate) => candidate.id === preferred?.id);
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
        players: { ...current.players, off: (current.players?.off ?? []).filter((other) => other !== id), preferred: id },
      }));
    },
    move: async (id, by) => {
      const listed = players((await deviceSettings.get()).players?.order).map((manifest) => manifest.id);
      const from = listed.indexOf(id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= listed.length) return;
      const order = [...listed];
      const moved = order[from];
      const displaced = order[to];
      if (moved === undefined || displaced === undefined) return;
      order[to] = moved;
      order[from] = displaced;
      // The whole list is stored, so the order holds even as the catalogue changes.
      await deviceSettings.update((current) => ({ ...current, players: { ...current.players, order } }));
    },
    setFirstOn: async (id, tab, first) => {
      await deviceSettings.update((current) => {
        const { [tab]: now, ...others } = current.players?.tabs ?? {};
        if (!first && now !== id) return current;
        const tabs = first ? { ...others, [tab]: id } : others;
        return {
          ...current,
          players: {
            ...current.players,
            ...(first ? { off: (current.players?.off ?? []).filter((other) => other !== id) } : {}),
            tabs,
          },
        };
      });
    },
  };
}
