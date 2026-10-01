export const MEDIA_CAPABILITIES = [
  'browse',
  'search',
  'libraries',
  'collections',
  'playlists',
  // Live channels, in groups: `listChannelGroups`, `listChannels`. What is live
  // is a kind of content, `live`, not a capability.
  'channels',
  // The guide for the channels a source brings.
  'epg',
  // Something to play: `getPlaybackDescriptor`.
  'playback',
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

/** A capability qualified by its block, the way a setting's `gates` names it. */
export type CapabilityKey = `media.${MediaCapability}`;
