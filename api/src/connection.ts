import type { FieldValues } from './fields';
import type { ConnectionId, CredentialsRef, PluginId } from './ids';
import type { PluginManifest, PluginRole } from './manifest';

/**
 * What each profile keeps for itself on a connection. `none`: every profile
 * uses the same values. `credentials`: each profile signs in with its own
 * account. `all`: each profile has its own value for every field and setting.
 */
export type PerProfile = 'none' | 'credentials' | 'all';

export const PER_PROFILE_MODES: readonly PerProfile[] = ['none', 'credentials', 'all'];

/** A role missing here is off, so a role a plugin gains later never appears enabled. */
export type ConnectionRoles = Readonly<Partial<Record<PluginRole, boolean>>>;

/** One set of values: the connection's shared ones, or one profile's own. */
export interface ConnectionValues {
  /** Non-secret connection-field values. */
  readonly fields: FieldValues;
  readonly settings: FieldValues;
  /** Handle to the password-field values, which live in the credential store. */
  readonly credentialsRef?: CredentialsRef;
  /** Which password fields hold a saved value — never the values themselves. */
  readonly secretKeys?: readonly string[];
}

/**
 * One configured instance of a plugin — "Jellyfin Home". Every connection
 * belongs to the device; `perProfile` decides which of its values each profile
 * keeps separately, and those are stored with the profile.
 */
export interface Connection {
  readonly id: ConnectionId;
  readonly pluginId: PluginId;
  readonly label: string;
  readonly roles: ConnectionRoles;
  readonly perProfile: PerProfile;
  /** The values every profile shares. */
  readonly values: ConnectionValues;
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
