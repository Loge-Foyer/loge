# API

The domain vocabulary and every contract a plugin implements.

What a film is, what a profile is, what watch progress means. What a plugin
must provide, in each category: to serve content, to play it, or to keep the
account.

## It depends on nothing

Not React, not Expo, not the app, not a plugin. That is what lets the app and a
few dozen plugins agree without any of them knowing about each other.

The app depends on this, and so does every plugin. The sync server is Go and
cannot import it: it implements the account protocol stated here, and the JSON
fixtures in `fixtures/` are how both sides are held to the same records. This
is the centre of the whole project, and it must stay a leaf. The React half of
the player contract lives next door, in `../player-kit`, so that this can.

## Status

**Written:**

- **The manifest and connections:**
  - the manifest vocabulary, connections with per-profile values, and
    manifest validation
  - categories (`sources`, `iptv`, `players`, `sync`), platforms, and ids
    qualified by category
- **The media domain:**
  - `MediaItem`, `GlobalMediaKey`, images, watch status
  - `ItemQuery` and the one ordering rule
  - live TV: channel groups, channels, the guide
- **Plumbing:** `AppError` with retry hints, and the `HttpClient` port.
- **The media role contract**, with the context the host supplies. It includes
  the channel, guide and playback members.
- **Playback:**
  - what to play: `PlaybackDescriptor`, and what an engine plays,
    `PlayerProfile`
  - the player role: `MediaPlayer` and `PlayerEvent`
  - `choosePlayer`
- **The account role**, record by record, with `isAccountRecord`; and the
  backup role.
- **The host's crypto port**, and bytes as text, both written for a host with
  no WebCrypto.

See `../docs/api/`.
