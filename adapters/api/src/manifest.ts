import type { AccountManifest, AccountRole } from './account';
import type { BackupManifest, BackupRole } from './backup';
import type { CapabilityKey, MediaCapability } from './capabilities';
import type { PlatformId, PluginCategory } from './category';
import type { ContentKind } from './content';
import type { SearchScope } from './query';
import type { BooleanField, Field, LibrariesField, SelectField, TextField, UrlField } from './fields';
import type { PluginId } from './ids';
import type { MediaRole } from './media-role';
import type { PlayerManifest, PlayerRole } from './player';

export interface MediaRoleManifest {
  /** What this source can bring. */
  readonly contentKinds: readonly ContentKind[];
  readonly capabilities: readonly MediaCapability[];
  /**
   * What its search can be narrowed to besides everything — only videos, only
   * channels, only playlists — honoured through `ItemQuery.scope`. Needs
   * `search`. Absent: a search answers with what the kind holds, and the app
   * offers no choice.
   */
  readonly searchScopes?: readonly SearchScope[];
}

/** A boolean setting that can switch capabilities off for one connection. */
export interface ToggleSetting extends BooleanField {
  readonly gates?: readonly CapabilityKey[];
}

/**
 * Settings live in a plain database column, so a setting can never be a
 * password. Secrets are connection fields.
 */
export type PluginSettingDescriptor = TextField | UrlField | SelectField | ToggleSetting | LibrariesField;

export interface PluginManifest {
  /** `category/name`, which is also the plugin's folder: `sources/jellyfin`. */
  readonly id: PluginId;
  /** Which list the plugin is in, and which one block it declares. */
  readonly category: PluginCategory;
  /** Where it runs. The app offers it only there. */
  readonly platforms: readonly PlatformId[];
  readonly displayName: string;
  /** One sentence for the plugin list. */
  readonly description: string;
  /** Sources and IPTV. */
  readonly media?: MediaRoleManifest;
  /** Players. */
  readonly player?: PlayerManifest;
  /** Sync: where the account is kept. */
  readonly account?: AccountManifest;
  /** Sync: where the account's backup file is kept. */
  readonly backup?: BackupManifest;
  /** What a connection needs: endpoint, account, secrets. */
  readonly connectionFields: readonly Field[];
  readonly settings: readonly PluginSettingDescriptor[];
}

/**
 * What a plugin package exports: its manifest, and the role its block
 * promises once it is written. A declared capability promises the members it
 * maps to (`MEDIA_CAPABILITY_MEMBERS`); an account's `ownerProof` promises
 * `verifyOwner`, and its `signUp` promises `createAccount`.
 */
export interface Plugin {
  readonly manifest: PluginManifest;
  readonly media?: MediaRole;
  readonly player?: PlayerRole;
  readonly account?: AccountRole;
  readonly backup?: BackupRole;
}

export function isToggle(setting: PluginSettingDescriptor): setting is ToggleSetting {
  return setting.type === 'boolean';
}
