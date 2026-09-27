import type { PluginId } from '@sc/api';

import type { DevicePluginState, DeviceSettingsRepository } from './ports';

/** A plugin this device has never touched: not installed. */
export const PLUGIN_OFF: DevicePluginState = { enabled: false };

export interface DevicePlugins {
  /** Every plugin's state, from one read. A plugin missing here is off: `PLUGIN_OFF`. */
  states(): Promise<Readonly<Partial<Record<PluginId, DevicePluginState>>>>;
  /** Installing a plugin is enabling it on this device. */
  setEnabled(id: PluginId, enabled: boolean): Promise<void>;
}

export function createDevicePlugins(settings: DeviceSettingsRepository): DevicePlugins {
  return {
    states: async () => (await settings.get()).plugins,
    setEnabled: async (id, enabled) => {
      await settings.update((current) => ({
        ...current,
        plugins: { ...current.plugins, [id]: { ...(current.plugins[id] ?? PLUGIN_OFF), enabled } },
      }));
    },
  };
}
