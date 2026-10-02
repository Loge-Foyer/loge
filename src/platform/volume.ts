import { nativeVolume } from '../../modules/loge-volume';
import type { SystemVolume } from '@/services/ports';

/**
 * The device's media volume, for the slider down one edge of the player. A
 * failure here is never worth one mid-film: the slider simply stays put.
 */
export const systemVolume: SystemVolume = {
  get: async () => {
    try {
      return nativeVolume()?.get() ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: async (value) => {
    try {
      await nativeVolume()?.set(Math.min(1, Math.max(0, value)));
    } catch {
      // As above.
    }
  },
  subscribe: (listener) => {
    const module = nativeVolume();
    if (!module) return () => undefined;
    const subscription = module.addListener('onChange', ({ volume }) => listener(volume));
    return () => subscription.remove();
  },
  attach: async () => {
    try {
      await nativeVolume()?.attach();
    } catch {
      // As above.
    }
  },
  release: async () => {
    try {
      await nativeVolume()?.release();
    } catch {
      // As above.
    }
  },
};
