import type { FieldValues } from './fields';
import type { ConnectionId, CredentialsRef, PluginId, UserId } from './ids';
import type { PluginManifest, PluginRole } from './manifest';

/**
 * Who a connection belongs to. A device connection is shared by every profile
 * on the device; a user connection belongs to one profile and goes with it.
 */
export type ConnectionOwner =
  | { readonly scope: 'device' }
  | { readonly scope: 'user'; readonly userId: UserId };

/** A role missing here is off, so a role a plugin gains later never appears enabled. */
export type ConnectionRoles = Readonly<Partial<Record<PluginRole, boolean>>>;

export interface Connection {
  readonly id: ConnectionId;
  readonly owner: ConnectionOwner;
  readonly pluginId: PluginId;
  readonly label: string;
  readonly roles: ConnectionRoles;
  /** Non-secret connection-field values. */
  readonly fields: FieldValues;
  readonly settings: FieldValues;
  /** Handle to the password-field values, which live in the credential store. */
  readonly credentialsRef?: CredentialsRef;
}

/**
 * Roles switched on for a new connection. Media starts on. Sync starts on only
 * when it is the plugin's single role — adding a sync-only plugin is the
 * opt-in — and even then every capability toggle still starts off.
 */
export function defaultRoles(manifest: PluginManifest): ConnectionRoles {
  return {
    ...(manifest.media ? { media: true } : {}),
    ...(manifest.sync ? { sync: manifest.media === undefined } : {}),
  };
}
