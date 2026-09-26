# Jellyfin

Self-hosted film and TV server, and the primary target. The app reads its
library and what each server user has watched. Jellyfin stays the master of that
watch status: the app keeps a cache, and — once playback exists — sends progress
back to it.

## Roles

**Media.** No sync role: the device's one account (iCloud, Google, your own sync
server) is where the app keeps its own state, and a Jellyfin server has no place
for profiles or preferences anyway.

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
`watchStateRead` (watched, progress, continue watching), `remoteImages`,
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

## Status

The media role is implemented and tested against recorded 12.x payloads.
Writing progress back (`watchStateWrite`) arrives with playback.

See `docs/writing-a-plugin/` at the repository root.
