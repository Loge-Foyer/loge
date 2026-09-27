import type { CapabilityKey, MediaCapability, SyncCapability } from './capabilities';
import type { ContentKind } from './content';
import type { BooleanField, Field, LibrariesField, SelectField, TextField, UrlField } from './fields';
import type { PluginId } from './ids';
import type { MediaRole } from './media-role';
import type { SyncRole } from './sync';

export type PluginRole = 'media' | 'sync';

export interface MediaRoleManifest {
  /** What this source can bring. */
  readonly contentKinds: readonly ContentKind[];
  readonly capabilities: readonly MediaCapability[];
}

export interface SyncRoleManifest {
  readonly capabilities: readonly SyncCapability[];
  /**
   * The password fields the owner check asks for again — Forgot PIN, switching
   * and signing out — handed to `verifyOwner`. Without them, the account
   * vouches with no proof, or the device answers.
   */
  readonly ownerProof?: { readonly fields: readonly string[] };
  /** Creating an account from the app: the fields it takes beyond the connection's own, handed to `createAccount`. */
  readonly signUp?: { readonly fields: readonly Field[] };
}

/**
 * A boolean setting that can switch capabilities off for one connection. For
 * the account, signing in is the opt-in, so a sync toggle is optional and may
 * default on; the sync role itself is off until the connection is chosen as
 * the account.
 */
export interface ToggleSetting extends BooleanField {
  readonly gates?: readonly CapabilityKey[];
}

/**
 * Settings live in a plain database column, so a setting can never be a
 * password. Secrets are connection fields.
 */
export type PluginSettingDescriptor = TextField | UrlField | SelectField | ToggleSetting | LibrariesField;

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

/**
 * What a plugin package exports. A role's implementation joins the manifest
 * once it is written; a declared capability promises the members it maps to
 * (`MEDIA_CAPABILITY_MEMBERS`, `SYNC_PROVIDER_MEMBERS`,
 * `SYNC_CAPABILITY_MEMBERS`), as `ownerProof` promises `verifyOwner` and
 * `signUp` promises `createAccount`.
 */
export interface Plugin {
  readonly manifest: PluginManifest;
  readonly media?: MediaRole;
  readonly sync?: SyncRole;
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
