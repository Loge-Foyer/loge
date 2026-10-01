import type { DeviceSettingsRepository, DownloadSettings } from '../ports';

const GB = 1024 * 1024 * 1024;

/**
 * What this device keeps by default. Generous enough to be worth having and
 * small enough that nobody discovers it by running out of room.
 */
export const DOWNLOAD_DEFAULTS: DownloadSettings = {
  maxBytes: 16 * GB,
  // On: a film over mobile data is somebody's whole month.
  onlyOnWifi: true,
  // 1080p at 8 Mbps is about 7 GB for a two-hour film, and is what a phone
  // screen can show. 4K on a phone costs five times the space for a picture
  // nobody can see at that size.
  maxHeight: 1080,
  maxBitrate: 8_000_000,
  // Off: tone-mapping is a transcode either way, and an SDR copy is what most
  // phones show correctly.
  hdr: false,
  askForSmaller: true,
};

/** The ceilings worth offering, in bytes. */
export const SIZE_CHOICES: readonly number[] = [2 * GB, 4 * GB, 8 * GB, 16 * GB, 32 * GB, 64 * GB, 128 * GB];

/** The heights worth offering. */
export const HEIGHT_CHOICES: readonly number[] = [480, 720, 1080, 2160];

/** Bits per second, paired loosely with the heights above. */
export const BITRATE_CHOICES: readonly number[] = [1_500_000, 4_000_000, 8_000_000, 16_000_000, 40_000_000];

export interface DownloadSettingsService {
  get(): Promise<DownloadSettings>;
  set(change: Partial<DownloadSettings>): Promise<DownloadSettings>;
}

export function createDownloadSettingsService(deps: { readonly deviceSettings: DeviceSettingsRepository }): DownloadSettingsService {
  const get = async (): Promise<DownloadSettings> => ({ ...DOWNLOAD_DEFAULTS, ...(await deps.deviceSettings.get()).downloads });
  return {
    get,
    set: async (change) => {
      const next = { ...(await get()), ...change };
      await deps.deviceSettings.update((current) => ({ ...current, downloads: next }));
      return next;
    },
  };
}
