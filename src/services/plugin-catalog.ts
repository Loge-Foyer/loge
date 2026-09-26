import {
  validateManifest,
  type ContentKind,
  type MediaRole,
  type Plugin,
  type PluginId,
  type PluginManifest,
} from '@sc/api';

export interface PluginCatalog {
  list(): readonly PluginManifest[];
  get(id: PluginId): PluginManifest | undefined;
  /**
   * Plugins whose media role brings any of `kinds`. Declared kinds are fine
   * here: nothing is called on a plugin from the catalogue.
   */
  bringing(kinds: readonly ContentKind[]): readonly PluginManifest[];
  /** The media role's implementation, once the plugin has one. */
  mediaRole(id: PluginId): MediaRole | undefined;
}

export interface CatalogOptions {
  /** Throw on an invalid manifest instead of leaving the plugin out. */
  readonly strict: boolean;
  readonly warn: (message: string) => void;
}

export function createPluginCatalog(
  plugins: readonly Plugin[],
  { strict, warn }: CatalogOptions,
): PluginCatalog {
  const byId = new Map<PluginId, PluginManifest>();
  const roles = new Map<PluginId, MediaRole>();
  for (const { manifest, media } of plugins) {
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
    byId.set(manifest.id, manifest);
    if (media) roles.set(manifest.id, media);
  }

  const manifests = [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return {
    list: () => manifests,
    get: (id) => byId.get(id),
    bringing: (kinds) =>
      manifests.filter((manifest) =>
        manifest.media?.contentKinds.some((kind) => kinds.includes(kind)),
      ),
    mediaRole: (id) => roles.get(id),
  };
}
