import type { PluginId } from '@sc/api';

import type { DevicePluginState, DeviceSettingsRepository } from './ports';

/** A plugin this device has never touched: not installed, configured once for everyone. */
export const PLUGIN_OFF: DevicePluginState = { enabled: false, perProfile: false };

export interface DevicePlugins {
  state(id: PluginId): Promise<DevicePluginState>;
  /** Installing a plugin is enabling it on this device. */
  setEnabled(id: PluginId, enabled: boolean): Promise<void>;
  /**
   * Off: the plugin's connections are the device's, shared by every profile.
   * On: each profile has its own. Both sets are kept; this only picks the live one.
   */
  setPerProfile(id: PluginId, perProfile: boolean): Promise<void>;
}

export function createDevicePlugins(settings: DeviceSettingsRepository): DevicePlugins {
  const change = (id: PluginId, patch: Partial<DevicePluginState>) =>
    settings.update((current) => ({
      ...current,
      plugins: { ...current.plugins, [id]: { ...(current.plugins[id] ?? PLUGIN_OFF), ...patch } },
    }));

  return {
    state: async (id) => (await settings.get()).plugins[id] ?? PLUGIN_OFF,
    setEnabled: async (id, enabled) => {
      await change(id, { enabled });
    },
    setPerProfile: async (id, perProfile) => {
      await change(id, { perProfile });
    },
  };
}
