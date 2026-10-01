import type { FieldValues } from './fields';
import type { ConnectionId, CredentialsRef, PluginId } from './ids';

/**
 * What each profile keeps for itself on a connection. `none`: every profile
 * uses the same values. `credentials`: each profile signs in with its own
 * account. `all`: each profile has its own value for every field and setting.
 */
export type PerProfile = 'none' | 'credentials' | 'all';

export const PER_PROFILE_MODES: readonly PerProfile[] = ['none', 'credentials', 'all'];

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
 * One configured instance of a plugin — "Jellyfin Home". A source's or an IPTV
 * plugin's connection belongs to the account, and travels with it; a sync
 * plugin's belongs to the device. `perProfile` decides which of its values
 * each profile keeps separately, and those are stored with the profile.
 */
export interface Connection {
  readonly id: ConnectionId;
  readonly pluginId: PluginId;
  readonly label: string;
  /** Switched off, it stays configured and nothing of it is used, on any device of the account. */
  readonly enabled: boolean;
  readonly perProfile: PerProfile;
  /** The values every profile shares. */
  readonly values: ConnectionValues;
}
