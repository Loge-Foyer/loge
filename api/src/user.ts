import type { UserId } from './ids';

/** A local profile. Not a provider account: Alex is not a Jellyfin user. */
export interface AppUser {
  readonly id: UserId;
  readonly name: string;
  readonly pinProtected: boolean;
}
