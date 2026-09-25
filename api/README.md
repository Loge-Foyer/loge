# API

The domain vocabulary and every contract a plugin implements.

What a film is, what a profile is, what watch progress means, what a plugin must
provide to serve content or carry state.

## It depends on nothing

Not React, not Expo, not the app, not a plugin. That is what lets the app and a
dozen plugins agree without any of them knowing about each other.

The app depends on this. Every plugin depends on this. The sync server depends
on this for its wire types. It is the centre of the whole project, and it must
stay a leaf.

## Status

The manifest half is written: branded IDs, content kinds, capability flags,
field descriptors, the plugin manifest, connections, profiles, the
effective-roles rule and manifest validation. See `../docs/api/`.

Still to come: the role contracts (`MediaRole`, `SyncRole`), `MediaItem`,
playback descriptors and the error model.
