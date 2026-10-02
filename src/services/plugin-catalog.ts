import {
  runsOn,
  validateManifest,
  type AccountRole,
  type BackupRole,
  type MediaRole,
  type MetadataRole,
  type PlatformId,
  type Plugin,
  type PluginCategory,
  type PluginId,
  type PluginManifest,
} from '@sc/api';

import { showsOn, type ContentTab } from './tab-content';

export interface PluginCatalog {
  /** The platform the app runs on; the catalogue holds only plugins that run here. */
  readonly platform: PlatformId;
  list(): readonly PluginManifest[];
  /** One category's plugins, for its list in Settings → Adapters. */
  inCategory(category: PluginCategory): readonly PluginManifest[];
  /**
   * A plugin that runs here. One the account holds a connection for, but that
   * does not run on this platform — IPTV on the web — is not part of it.
   */
  get(id: PluginId): PluginManifest | undefined;
  /**
   * Plugins that bring something to `tab`. Declared kinds are fine here:
   * nothing is called on a plugin from the catalogue.
   */
  showingOn(tab: ContentTab): readonly PluginManifest[];
  /** The media role's implementation, once the plugin has one. */
  mediaRole(id: PluginId): MediaRole | undefined;
  /** The account role's implementation: where the device's account can live. */
  accountRole(id: PluginId): AccountRole | undefined;
  /** The backup role's implementation: where the account's backup file can go. */
  backupRole(id: PluginId): BackupRole | undefined;
  /** The metadata role's implementation: what a title is. */
  metadataRole(id: PluginId): MetadataRole | undefined;
}

export interface CatalogOptions {
  readonly platform: PlatformId;
  /** Throw on an invalid manifest instead of leaving the plugin out. */
  readonly strict: boolean;
  readonly warn: (message: string) => void;
}

export function createPluginCatalog(
  plugins: readonly Plugin[],
  { platform, strict, warn }: CatalogOptions,
): PluginCatalog {
  const byId = new Map<PluginId, PluginManifest>();
  const roles = new Map<PluginId, MediaRole>();
  const accountRoles = new Map<PluginId, AccountRole>();
  const backupRoles = new Map<PluginId, BackupRole>();
  const metadataRoles = new Map<PluginId, MetadataRole>();
  for (const { manifest, media, account, backup, metadata } of plugins) {
    const problems = [
      ...validateManifest(manifest),
      ...(byId.has(manifest.id) ? ['its id is already registered'] : []),
    ];
    if (problems.length > 0) {
      // A manifest is static, so this is a bug in the plugin: loud in
      // development, and in production the plugin is left out rather than
      // taking the whole app down with it.
      const message = `Plugin "${manifest.id}" is invalid:\n- ${problems.join('\n- ')}`;
      if (strict) throw new Error(message);
      warn(message);
      continue;
    }
    // Offering a plugin that cannot run here would only ever fail.
    if (!runsOn(manifest, platform)) continue;
    byId.set(manifest.id, manifest);
    if (media) roles.set(manifest.id, media);
    if (account) accountRoles.set(manifest.id, account);
    if (backup) backupRoles.set(manifest.id, backup);
    if (metadata) metadataRoles.set(manifest.id, metadata);
  }

  const manifests = [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return {
    platform,
    list: () => manifests,
    inCategory: (category) => manifests.filter((manifest) => manifest.category === category),
    get: (id) => byId.get(id),
    showingOn: (tab) => manifests.filter((manifest) => showsOn(tab, manifest.category, manifest.media?.contentKinds ?? [])),
    mediaRole: (id) => roles.get(id),
    accountRole: (id) => accountRoles.get(id),
    backupRole: (id) => backupRoles.get(id),
    metadataRole: (id) => metadataRoles.get(id),
  };
}
