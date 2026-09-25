import type { CapabilityKey, MediaCapability, SyncCapability } from './capabilities';
import type { ContentKind } from './content';
import type { BooleanField, Field, SelectField, TextField, UrlField } from './fields';
import type { PluginId } from './ids';

export type PluginRole = 'media' | 'sync';

export interface MediaRoleManifest {
  /** What this source can bring. */
  readonly contentKinds: readonly ContentKind[];
  readonly capabilities: readonly MediaCapability[];
}

export interface SyncRoleManifest {
  readonly capabilities: readonly SyncCapability[];
}

/**
 * A boolean setting that can switch capabilities off for one connection. One
 * gating a sync capability must default to `false`: connecting a plugin for
 * media must never start carrying the user's state somewhere.
 */
export interface ToggleSetting extends BooleanField {
  readonly gates?: readonly CapabilityKey[];
}

/**
 * Settings live in a plain database column, so a setting can never be a
 * password. Secrets are connection fields.
 */
export type PluginSettingDescriptor = TextField | UrlField | SelectField | ToggleSetting;

export interface PluginManifest {
  readonly id: PluginId;
  readonly displayName: string;
  /** One sentence for the plugin list. */
  readonly description: string;
  readonly media?: MediaRoleManifest;
  readonly sync?: SyncRoleManifest;
  /**
   * What a connection needs: endpoint, account, secrets. Shared by every role,
   * because one connection has one endpoint and one set of credentials.
   */
  readonly connectionFields: readonly Field[];
  readonly settings: readonly PluginSettingDescriptor[];
}

/** What a plugin package exports. Role implementations join it as they are built. */
export interface Plugin {
  readonly manifest: PluginManifest;
}

export function declaredRoles(manifest: PluginManifest): readonly PluginRole[] {
  return [
    ...(manifest.media ? (['media'] as const) : []),
    ...(manifest.sync ? (['sync'] as const) : []),
  ];
}

export function isToggle(setting: PluginSettingDescriptor): setting is ToggleSetting {
  return setting.type === 'boolean';
}
