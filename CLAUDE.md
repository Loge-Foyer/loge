# CLAUDE.md — streaming_center_app

The Streaming Center client. Expo + React Native + TypeScript, targeting iOS,
Android and web.

## Reading protocol — before you plan, edit or run anything

1. `../.claude/streaming-center-architecture.md` — the architecture
   specification, and the source of truth for every rule below.
2. `../CLAUDE.md` — how the three repositories relate.
3. `AGENTS.md` in this repository — imported below, read it fully.
4. `README.md` and `docs/` here, for whichever area you are touching.

Only then start work.

@AGENTS.md

## What this repository is and is not

**Owns:** screens, navigation, the design system, application services — boot,
the account, profiles and PINs, the sync engine, backups — the local database
and the backup file's format, platform access (keychain, biometrics, crypto,
files), and the composition root that wires everything together.

**Does not own:** domain types, plugin contracts, the player view contract, or
any plugin. Those are in `../streaming_center_plugins` — `@sc/api`,
`@sc/player-kit`, and `plugins/<category>/<name>`. If you find yourself writing
a `MediaItem` interface here, stop — it belongs in `@sc/api`.

## The three mistakes to avoid

**Defining domain types here.** The app and every plugin both need them. Putting
them in the app makes plugins depend on the app, and the dependency graph goes
circular. This is expensive to undo later.

**Naming a plugin above the composition root.** An `if (providerId ===
'jellyfin')` in a screen means the abstraction has already failed. Branch on
the plugin's category and its effective capabilities.

**Reaching for the network in a write path.** Local database plus journal entry
in one transaction, then return. The sync engine carries the journal to the
account later. And nothing but the database inside that transaction — not the
keychain, not WebCrypto: IndexedDB commits early, SQLite deadlocks.

## Current state

**Phase 6 — the code is on the new architecture. Phase 7 brings playback.**

The design: four tabs — Media, Videos, TV, Settings. Plugins come in four
categories, and Settings → Plugins shows one list per category for this
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
- Four tabs, and Settings → Plugins as four lists by category, of the plugins
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
  in a browser — with Resume, Mark watched, the tracks and Next episode.
  Players' switches and which plays first are per device. Videos still shows
  skeletons.
- Watch status (database v5): the cache and the outbox written together,
  a drainer carrying them to the source, and this device's state shown until
  the source has heard.
- vitest covers the database on both engines, every migration, the services,
  and two devices on one fake server on every pair of engines.

Documentation in `docs/` describes the target, not the present. When you build
something, update the matching doc in the same commit.

## Git

This repository has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
