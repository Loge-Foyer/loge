import type { SystemVolume } from '@/services/ports';

// A page has no volume of the device's to set: the player keeps to its engine's.
export const systemVolume: SystemVolume = {
  get: async () => undefined,
  set: async () => undefined,
  subscribe: () => () => undefined,
  attach: async () => undefined,
  release: async () => undefined,
};
