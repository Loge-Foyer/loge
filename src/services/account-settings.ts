import type { LocalDatabase } from './ports';
import { CONTENT_TABS, type ContentTab } from './tab-content';

/**
 * Which tabs the app keeps watch status on, for the sources there that keep
 * none of their own — the account's, the same for every profile and device.
 * A source that keeps its own (a media server) keeps it whatever this says:
 * nothing is kept twice (spec §9).
 */
export type WatchStatusSetting = Readonly<Record<ContentTab, boolean>>;

/**
 * Off on Media, where media servers keep their own; on for Videos and for
 * Live's films and series, where nothing else would.
 */
export const WATCH_STATUS_DEFAULTS: WatchStatusSetting = { media: false, videos: true, live: true };

const WATCH_STATUS = 'watchStatus';

/**
 * The setting's own keys. Live keeps the name the tab had before, `tv`:
 * older apps, your server and every backup read the record that way.
 */
const RECORD_KEYS: Readonly<Record<ContentTab, string>> = { media: 'media', videos: 'videos', live: 'tv' };

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
        const merged = { ...watchStatusOf(stored?.value), ...change };
        const value = Object.fromEntries(CONTENT_TABS.map((tab) => [RECORD_KEYS[tab], merged[tab]]));
        await tx.accountSettings.put({ name: WATCH_STATUS, value, version: (stored?.version ?? 0) + 1 });
      });
    },
  };
}

/** What was stored, or arrived from the account, read with care: a tab it does not say is the default. */
export function watchStatusOf(value: unknown): WatchStatusSetting {
  const stored = typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
  const pick = (tab: ContentTab) => {
    const kept = stored[RECORD_KEYS[tab]];
    return typeof kept === 'boolean' ? kept : WATCH_STATUS_DEFAULTS[tab];
  };
  return { media: pick('media'), videos: pick('videos'), live: pick('live') };
}
