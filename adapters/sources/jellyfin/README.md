# Jellyfin

Self-hosted film and TV server, and the primary target. The app reads its
library and what each server user has watched, plays it, and sends progress
back. Jellyfin stays the master of that watch status: the app keeps a cache.

## Category

**Source** — `sources/jellyfin`, in `plugins/sources/jellyfin`. It runs everywhere: iOS,
Android and the web, since Jellyfin answers a browser's CORS request.

A source and nothing else: Jellyfin masters what its users watched, and that
never goes through the account. Your account — local, or on your own server —
keeps the profiles and preferences; a Jellyfin server has no place for them
anyway. Its connections belong to the account, so every device on it has them.

## Brings

Movies and shows.

## Connection

- **Server address** — required. `scheme://host:port`, with the base path if the
  server has one. A pasted web-client address (`…/web/#/home`) works too.
- **Local network only** — on by default. The server is skipped on mobile data,
  and when it cannot be reached it is not tried again until the network changes.
- **Username** — required. A credential: a connection that separates
  credentials per profile keeps it per profile.
- **Password** — kept in the credential store, never shown again.

## Settings

- **Keep metadata on this device** — on by default. Gates `offlineMetadata`: the
  app may keep artwork, descriptions and cast so browsing is quick and works
  offline.
- **Libraries to show** — all of them, only some, or all except some, chosen from
  the libraries the server reports.

## What it can do

`browse` (films, series, seasons, episodes, detail pages), `libraries`,
`watchStateRead` (watched, progress, continue watching), `playback`,
`watchStateWrite` (progress and watched, back to the server), `remoteImages`,
`offlineMetadata`.

Worth knowing:

- **It talks to Jellyfin 10.9 and later** through the current API routes, which
  take `userId` as a query parameter.
- **One device id per install and account**, derived from the installation id
  and the username. Signing in one profile never ends another profile's
  session.
- **Sign-in happens once**, shared by every request that starts together. The
  token is kept in the session store the app provides.
- **A refused password is never tried again.** Jellyfin disables an account after
  repeated failed sign-ins.
- **Item artwork needs no sign-in,** so its addresses carry no token.
- **Libraries can't be combined in one query:** Jellyfin has no multi-library
  filter. "Only these" and "all except" ask each chosen library for a page and
  merge the pages in order.

## Playing

- **The server chooses the stream.** `getPlaybackDescriptor` sends
  `POST /Items/{id}/PlaybackInfo` with a `DeviceProfile` built from the chosen
  player's `PlayerProfile`: the files it plays as they are, a transcode to
  H.264 and AAC — HLS where the engine has it — for the rest, HDR only as far
  as the engine shows it, and the largest picture it takes. Jellyfin answers
  with the file itself or a transcode.
- **A file plays from its own address**, `/Videos/{id}/stream.{container}`
  with `static=true`; **a transcode from the server's**, `TranscodingUrl`, as
  it is. Both carry the session's token — a `<video>` element can send no
  header, and neither can a player given only a URL — so a descriptor lives in
  memory only.
- **The container is named as the player names it.** ffprobe calls an MP4
  `mov,mp4,m4a,3gp,3g2,mj2`, and Jellyfin passes on one name or all; the
  descriptor picks the one the player's profile lists, so `canPlay` agrees
  with the server.
- **Subtitles** the engine shows itself come inside the file (`Embed`) or in
  the transcode's playlist as WebVTT (`Hls`); anything else — PGS on a phone,
  say — the server burns in. An external file arrives with its address.
  Languages become BCP 47: `ger` and `deu` both become `de`.
- **On mobile data** a transcode is held to 8 Mbit/s; at home, 120.
- **Reports** go to `/Sessions/Playing`, `…/Progress` and `…/Stopped`, with
  the media source and play session its descriptor began; a stop ends the
  transcode. After a restart that session is gone, and a report names the item
  alone — which is all Jellyfin needs to keep the position. Jellyfin keeps a
  resume point only between 5% and 90% of the runtime. Reports are safe to
  deliver twice.
- **Watched and not** are `POST` and `DELETE /UserPlayedItems/{id}`.

## Status

The media role is implemented — playback and progress back included — and
tested against payloads shaped like Jellyfin 12.0's. It has been run against
a real Jellyfin 12 server: descriptors for the three platforms' profiles (a
Matroska film transcoded to HLS, an MP4 episode played as it is, every stream
answering), a stop saved as the resume point, and watched set and cleared.

Not yet: a trickplay frame on Continue Watching — no server to check the tile
sheets against — and HEVC in a transcode, which is always H.264 for now.

See `docs/writing-a-plugin/` at the repository root.
