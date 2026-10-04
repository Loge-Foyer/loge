export const MEDIA_CAPABILITIES = [
  'browse',
  'search',
  // What it files its titles under — `listGenres` — and only those of one:
  // `ItemQuery.genre` honoured, as `search` honours `term`.
  'genres',
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
  // The latest from a set of channels, in one call: `listFeed`. A source
  // without it has no feed row — asking each channel separately would be one
  // request per channel, which is not a row anyone would wait for.
  'feed',
  // A file the app may keep on the device: `getDownloadDescriptor`.
  'downloads',
  // There is more than one version to choose between — because the server will
  // make one (Jellyfin transcoding) or because several already exist (a site's
  // own renditions): `listDownloadOptions`. Without it a download takes
  // whatever the source hands over, and no sheet of choices is shown.
  'downloadOptions',
  // Not a call but a permission: the source's items keep stable ids and
  // tag-versioned artwork, so the app may keep them on the device.
  'offlineMetadata',
] as const;

export type MediaCapability = (typeof MEDIA_CAPABILITIES)[number];

/** A capability qualified by its block, the way a setting's `gates` names it. */
export type CapabilityKey = `media.${MediaCapability}`;
