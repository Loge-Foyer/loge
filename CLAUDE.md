# CLAUDE.md — streaming_center_app

The Streaming Center client. Expo + React Native + TypeScript, targeting iOS,
Android and web.

## Reading protocol — before you plan, edit or run anything

1. `../.claude/streaming-center-architecture.md` — the architecture
   specification, and the source of truth for every rule below.
2. `../CLAUDE.md` — how the app and the server relate.
3. `AGENTS.md` in this repository — imported below, read it fully.
4. `README.md` and `docs/` here, for whichever area you are touching.

Only then start work.

@AGENTS.md

## What this repository is and is not

**Owns:** screens, navigation, the design system, application services — boot,
the account, profiles and PINs, the sync engine, backups — the local database
and the backup file's format, platform access (keychain, biometrics, crypto,
files), and the composition root that wires everything together.

**`src/` does not own:** domain types, adapter contracts, the player view
contract, or any adapter. Those are in `adapters/` — `@sc/api`,
`@sc/player-kit`, and `<category>/<name>` — which live in this repository but
compile as programs of their own, with no host types. If you find yourself
writing a `MediaItem` interface in `src/`, stop: it belongs in `@sc/api`.

**The adapters moved in during Phase 9**, from a repository of their own. They
are npm workspaces, so there is one `node_modules` and one copy of React,
expo-video and everything else — which is what the split could never
guarantee. The boundary is unchanged, and is kept by `adapters/tsconfig.json`
(no host types), this repository's `tsconfig.json` (which excludes
`adapters/`), and lint.

## The three mistakes to avoid

**Defining domain types in `src/`.** `src/` and every adapter both need them.
Putting them in `src/` makes the adapters depend on the app, and the dependency
graph goes circular. One repository makes this *easier* to do by accident, not
harder — which is why `adapters/` is excluded from the app's TypeScript
program.

**Naming an adapter above the composition root.** An `if (providerId ===
'jellyfin')` in a screen means the abstraction has already failed. Branch on
the adapter's category and its effective capabilities.

**Reaching for the network in a write path.** Local database plus journal entry
in one transaction, then return. The sync engine carries the journal to the
account later. And nothing but the database inside that transaction — not the
keychain, not WebCrypto: IndexedDB commits early, SQLite deadlocks.

## Current state

**Phase 7 — it plays. Phase 8 brought more players; VLC left in Phase 9, and is back.**

The design: four tabs — Media, Videos, TV, Settings. Plugins come in four
categories, and Settings → Adapters shows one list per category for this
platform. A device holds one account, local or on your own server
(PocketBase), with up to ten profiles. Source and IPTV connections are
account-wide; players and sync plugins are device-wide. A server account syncs
by pushing the journal, then reading the whole account. An encrypted
`.scbackup` file carries a local account between devices, and players are
plugins.

What runs today:

- One account per device, local or on your own server — PocketBase, in
  `../streaming_center_sync`. Signing in replaces the device's account,
  signing up with an invite uploads it, and signing out keeps a local copy. A
  run pushes the journal, reads the whole account and reconciles; ten
  profiles at most, or the server's limit.
- Four tabs, and Settings → Adapters as four lists by category, of the plugins
  that run on this platform. TV holds IPTV: live channels with now and next,
  a day guide, channels played live, and the provider's films and series —
  Stalker and, in development, the mock portal.
- Real titles from every live source, merged — Jellyfin the first — and kept
  across restarts where the source allows it.
- SQLite and the keychain on phones, which run development builds; IndexedDB
  with WebCrypto-encrypted secrets on the web.
- The encrypted backup file: export, import, its key behind the owner check,
  Welcome's Restore, and backup targets that ask before overwriting.
- Press Play: Jellyfin films and episodes play on the built-in player —
  expo-video on phones, which turn it with the device, `<video>` with hls.js
  in a browser — with Resume, Mark watched, the tracks and Next episode. On
  mpv plays too, an Expo module in its adapter: Matroska, DTS and TrueHD as
  the file, raw MPEG-TS, a file's own subtitles drawn with libass — on Android
  and, built but not yet played, on iPhone. VLC is back — libVLC 3.7 on
  Android, VLCKit 3.7 on iPhone and Apple TV — and plays first on TV. A
  browser plays raw MPEG-TS through mpegts.js.
  Players' switches, which plays first — on the
  device and per tab — are per device, and "Play with…" picks one for an
  item. Videos is real: one source at a time, a paging grid, and
  `sources/yattee` — a Yattee Server instance — bringing web video to it.
- Search, closed: Media's grid searches the kind it shows, TV's Live searches
  channels and its films and series each search their own. Only sources whose
  `search` is in effect are asked, and nothing of a search is saved.
- Settings → App, device-wide: the tab the app opens on, always asking who's
  watching (on by default on a TV), and Force landscape on playback, on by
  default. Players can be reordered, and the order is the order they are tried
  in.
- Watch status (database v5): the cache and the outbox written together,
  a drainer carrying them to the source, and this device's state shown until
  the source has heard.
- Apple TV, from the same code: `npm run tvos` turns `ios/` into the TV
  project and builds it. The remote reaches every control, the type and
  spacing are sized for a room, the home has a spotlight, and what a TV lacks
  — files, Face ID, downloads — has a stand-in (`docs/platforms/tvos`).
- vitest covers the database on both engines, every migration, the services,
  and two devices on one fake server on every pair of engines.

Documentation in `docs/` describes the target, not the present. When you build
something, update the matching doc in the same commit.

## Git

This repository has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
