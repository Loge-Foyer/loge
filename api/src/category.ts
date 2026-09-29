import { pluginId, type PluginId } from './ids';

/**
 * The four kinds of plugin. Each has its folder under `plugins/`, its list in
 * Settings → Plugins, and one contract: sources and IPTV the media role,
 * players the player role, sync the account or the backup role.
 */
export const PLUGIN_CATEGORIES = ['sources', 'iptv', 'players', 'sync'] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/** Where the app runs. Named apart from React Native's `Platform`, which the app imports too. */
export const PLATFORMS = ['ios', 'android', 'web'] as const;

export type PlatformId = (typeof PLATFORMS)[number];

/**
 * Account-wide plugins travel with the account — to every device on it, to
 * your own server, into backups. Device-wide ones stay where they are set up.
 */
export type PluginScope = 'account' | 'device';

export const CATEGORY_SCOPE: Readonly<Record<PluginCategory, PluginScope>> = {
  sources: 'account',
  iptv: 'account',
  players: 'device',
  sync: 'device',
};

const NAME = /^[a-z][a-z0-9-]*$/;

/** `sources/jellyfin`: a plugin's category and name, which is also its folder under `plugins/`. */
export function qualifiedPluginId(category: PluginCategory, name: string): PluginId {
  if (!NAME.test(name)) throw new Error(`plugin name "${name}" must be kebab-case`);
  return pluginId(`${category}/${name}`);
}

/**
 * The category an id names, so a stored connection says what it is even in a
 * build without its plugin. Nothing for an id that is not qualified.
 */
export function categoryOfPluginId(id: string): PluginCategory | undefined {
  const slash = id.indexOf('/');
  if (slash < 0 || !NAME.test(id.slice(slash + 1))) return undefined;
  const category = id.slice(0, slash);
  return (PLUGIN_CATEGORIES as readonly string[]).includes(category) ? (category as PluginCategory) : undefined;
}

export function isQualifiedPluginId(id: string): boolean {
  return categoryOfPluginId(id) !== undefined;
}

/**
 * Whether a plugin runs on this platform. A manifest that names no platforms
 * was written before they were declared, and is taken to run everywhere.
 */
export function runsOn(manifest: { readonly platforms?: readonly PlatformId[] }, platform: PlatformId): boolean {
  return manifest.platforms === undefined || manifest.platforms.includes(platform);
}
