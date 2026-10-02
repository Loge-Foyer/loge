import type { LocalDatabase } from './ports';
import type { ContentTab } from './tab-content';

/**
 * Which tabs the app keeps watch status on, for the sources there that keep
 * none of their own — the account's, the same for every profile and device.
 * A source that keeps its own (a media server) keeps it whatever this says:
 * nothing is kept twice (spec §9).
 */
export type WatchStatusSetting = Readonly<Record<ContentTab, boolean>>;

/**
 * Off on Media, where media servers keep their own; on for Videos and for TV's
 * films and series, where nothing else would.
 */
export const WATCH_STATUS_DEFAULTS: WatchStatusSetting = { media: false, videos: true, tv: true };

const WATCH_STATUS = 'watchStatus';

export interface AccountSettingsService {
  watchStatus(): Promise<WatchStatusSetting>;
  /** Written here first and journaled, as any change to the account is; your server hears later. */
  setWatchStatus(change: Partial<WatchStatusSetting>): Promise<void>;
}

export function createAccountSettingsService(deps: { readonly db: LocalDatabase }): AccountSettingsService {
  const { db } = deps;
  const read = async (): Promise<WatchStatusSetting> => watchStatusOf((await db.accountSettings.get(WATCH_STATUS))?.value);
  return {
    watchStatus: read,
    setWatchStatus: async (change) => {
      await db.transaction(async (tx) => {
        const stored = await tx.accountSettings.get(WATCH_STATUS);
        const value = { ...watchStatusOf(stored?.value), ...change };
        await tx.accountSettings.put({ name: WATCH_STATUS, value, version: (stored?.version ?? 0) + 1 });
      });
    },
  };
}

/** What was stored, or arrived from the account, read with care: a tab it does not say is the default. */
export function watchStatusOf(value: unknown): WatchStatusSetting {
  const stored = typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
  const pick = (tab: ContentTab) => (typeof stored[tab] === 'boolean' ? (stored[tab] as boolean) : WATCH_STATUS_DEFAULTS[tab]);
  return { media: pick('media'), videos: pick('videos'), tv: pick('tv') };
}
