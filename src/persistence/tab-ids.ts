/**
 * The TV tab became Live (database version 11). A device's settings named the
 * tab by its id in two places — where the app opens, and which player plays
 * first on each tab — and say `live` from then on. Written out rather than
 * taken from `ContentTab`: the rename is history, and never changes again.
 * Answers what the setting becomes, or `undefined` where it stays as it is.
 */
export function liveTabSetting(key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const setting = value as Readonly<Record<string, unknown>>;
  if (key === 'app') return setting.openOn === 'tv' ? { ...setting, openOn: 'live' } : undefined;
  if (key !== 'players') return undefined;
  const tabs = setting.tabs;
  if (typeof tabs !== 'object' || tabs === null || !('tv' in tabs)) return undefined;
  const { tv, ...others } = tabs as Readonly<Record<string, unknown>>;
  // A device that already chose for Live keeps that choice.
  return { ...setting, tabs: 'live' in others ? others : { ...others, live: tv } };
}
