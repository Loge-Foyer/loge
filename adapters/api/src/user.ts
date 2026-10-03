import type { UserId } from './ids';

/** A local profile. Not a provider account: Alex is not a Jellyfin user. */
export interface AppUser {
  readonly id: UserId;
  readonly name: string;
  /** Whether this device asks for a PIN for it: the account's, or one this device keeps for itself. */
  readonly pinProtected: boolean;
}
