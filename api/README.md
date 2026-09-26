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

Written:

- the manifest vocabulary, connections with per-profile values, and the
  effective-roles rule
- manifest validation
- the media domain (`MediaItem`, `GlobalMediaKey`, images, watch status)
- `ItemQuery` and the one ordering rule
- `AppError` with retry hints and the `HttpClient` port
- the media role contract, with the context the host supplies

See `../docs/api/`.

Still to come: the sync contract (`SyncRole`) and playback descriptors.
