export const MEDIA_CAPABILITIES = [
  'browse',
  'search',
  'libraries',
  'collections',
  'playlists',
  'channels',
  'live',
  'watchStateRead',
  'watchStateWrite',
  'favoritesRead',
  'favoritesWrite',
  'remoteImages',
  // Not a call but a permission: the source's items keep stable ids and
  // tag-versioned artwork, so the app may keep them on the device.
  'offlineMetadata',
] as const;

export type MediaCapability = (typeof MEDIA_CAPABILITIES)[number];

export const SYNC_CAPABILITIES = [
  'profile',
  'preferences',
  'watchProgress',
  'favorites',
  'watchlist',
  'history',
  'providerConnections',
  'customLists',
  'fullBackup',
] as const;

export type SyncCapability = (typeof SYNC_CAPABILITIES)[number];

/** A capability qualified by its role, the way a setting's `gates` names it. */
export type CapabilityKey = `media.${MediaCapability}` | `sync.${SyncCapability}`;
