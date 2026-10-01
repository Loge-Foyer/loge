# CLAUDE.md — adapters

Every adapter Streaming Center has to the outside world, plus `api` — the
vocabulary the app and all plugins are written in.

## Reading protocol — before you plan, edit or run anything

1. `../../.claude/streaming-center-architecture.md` — the architecture
   specification. Section 7 defines the plugin model; section 8 is the roster.
2. `../CLAUDE.md` — the app this folder lives in.
3. `AGENTS.md` here — imported below, read it fully.
4. `docs/` for the area you are touching, then the target plugin's `README.md`.

Only then start work.

@AGENTS.md

## Why this folder is the centre

`api` is what the app and every plugin agree on. Both sides need `MediaItem`,
`GlobalMediaKey` and the capability types, so those cannot live in the app —
that would make plugins depend on the app and the dependency graph circular.

So this folder depends on nothing, and everything else points at it. An
`import` of React, Expo or the app anywhere in `api` breaks the property the
whole split exists to provide. The React half of the player contract has its
own package, `player-kit`, for exactly that reason.

## One category per plugin

A plugin does one job — serve media, bring IPTV, play, or keep the account —
and lives in that job's folder: `adapters/sources`, `adapters/iptv`,
`adapters/players`, `adapters/sync`. Its id is the path: `sources/jellyfin`.

A service that does two jobs is two plugins. Google Drive's files are
`sources/google-drive`; Google Drive as a backup place is `sync/google-drive`.
They share no code.

Media servers (Jellyfin, Emby, Plex) are **sources only**. The server is the
master of what its users watched; the app reads it and writes progress back
through the media role, never through the account.

## The mistake that costs the most

**Overstating a capability.** The app acts on what you declare.

- Claim `browse` without it working, and every row shows an error for that
  source.
- Claim a player plays MKV when it does not, and the user gets a black screen
  instead of the player that would have worked.
- Claim an account can hold something it drops, and state disappears with no
  error, surfacing weeks later as "my settings are gone".

Declare honestly. Doing less is always better than pretending.

## The mistake that is new

**Putting a second job into a plugin.** It is tempting to give the Google
Drive source an `account` block "because it is the same sign-in". Don't. The
categories keep the lists in Settings honest, and keep the property that
adding a source never changes where your account lives.

The second new one: **forgetting `platforms`.** A plugin that cannot run in a
browser — iCloud's container, a portal without CORS — must not say `web`, or
the app offers something that can only fail.

## The third mistake

**Letting an external type escape.** A Jellyfin response shape in a return value
means the app now knows about Jellyfin, and every later plugin has to imitate
its quirks. Map inside the package, always.

## Order of work

`api` first — nothing else can be built correctly until the vocabulary exists.
The manifest, the media contract, the player contract, the account role and the
backup role are written. `mock` implements the media role so the app works
offline, and deliberately declines some capabilities, so the app's capability
handling stays genuinely tested. Jellyfin is the first real media source, and
`sources/yattee` the first that brings `videos` rather than a library.

## Current state

Phase 6 moved the code to the new architecture: the plugins are in their
category folders, with qualified ids, categories and platforms, and the account
is kept record by record on your own server, PocketBase. Phase 7 made it play;
Phase 8 added players; Phase 9 dropped VLC and left mpv.

- **`api`:** holds these, with its tests:
  - the manifest vocabulary, with categories, platforms, qualified ids, and
    the player, account and backup blocks
  - search as a `term` on the queries that already page, and `matchesTerm`
    for a source that matches on the device
  - per-profile values, the media contract with live TV and playback members,
    and watch state written back (`reportPlayback`, `setPlayed`)
  - the player contract, the account role (records), the backup role
  - errors, the HTTP port and the host's crypto port
- **`player-kit`:** `PlayerView`'s props and `PlayerPlugin`.
- **Built-in player:** `players/system` implements the player role —
  expo-video on phones, `<video>` with a lazily loaded hls.js on the web, a
  profile per platform — tested against fakes of expo-video, the element and
  hls.js.
- **mpv:** `players/mpv` implements it on both phones — libmpv's own C API
  behind one Expo module, through this project's JNI on Android and straight
  from Swift on iOS, because neither may ask mpv for a log message: the
  engine's published Android wrapper does, and prints every stream address it
  opens. Android decodes in software for now and so stops at 1080p; iOS uses
  VideoToolbox and claims 4K. libass draws the subtitles, and it is the one
  engine here that sends any header a stream needs.
- **Yattee Server:** `sources/yattee` implements the media role against a
  self-hosted yattee-server — HTTP Basic Auth, an Invidious-compatible API,
  trending and search, channels and playlists as things with videos inside
  them, and playback from the muxed renditions only, because `adaptiveFormats`
  needs a manifest no engine here is handed. Tested against a fake of its
  routes; not yet run against a real instance.
- **Jellyfin:** implements the media role, tested with a fake HTTP client and
  recorded 12.x payloads — playback through `PlaybackInfo` with a
  `DeviceProfile` from the player's profile, and progress and watched state
  back; run against a real Jellyfin 12.
- **Mock:** `sources/mock` implements the media role with a fixed catalogue,
  and `iptv/mock` with live TV — groups, channels, a guide, a few films and
  series, public test streams to play; `sync/mock` plays at being your own
  server in memory, and `sync/mock-backup` at being a backup target.
- **Stalker:** implements the media role against a Stalker portal —
  handshake and profile, live TV with its guide, links made when playing,
  films, and series from whichever section the portal keeps them in. Tested
  against a fake portal, and run against a real one: 4,658 channels, a day of
  guide, and a series' episodes played.
- **Custom server:** implements the account role on PocketBase — sign-in,
  reading the whole account, batches, sign-up with an invite, the owner check.
- **Every other plugin:** a manifest — the other IPTV plugins, KSPlayer, and
  the backup targets included.
- **`npm run typecheck`:** three programs — `api` and the non-player plugins
  with no host types at all; `player-kit` and the players with React Native's
  and the DOM's; the tests with Node's.
- **`npm test`:** runs everything.
  - the api rules, bytes as text, and the contracts: categories, account
    records against their shared fixtures, choosing a player
  - Jellyfin's behaviour: sign-in, local-only, paging, mapping, the
    `DeviceProfile`, direct play and transcodes, reports and watched state
  - the mock, as a source, an IPTV portal, an account and a backup target
  - the built-in player's engines, against fakes (`vitest.config.ts` aliases
    expo-video; the web engine takes its `<video>` and hls.js from its host),
    and mpv's, against a fake of its Expo module (aliased
    `expo`)
  - the custom server against a fake of PocketBase's routes and rules
  - Stalker against a fake portal
  - the conformance check that each declared capability is implemented

## Git

This folder has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
