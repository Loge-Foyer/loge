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

**Phase 5 — the new architecture is written down; the code is still Phase 4's
until Phase 6.**

The target: four tabs — Media, Videos, TV, Settings. Plugins come in four
categories, and Settings → Plugins shows one list per category for this
platform. A device holds one account, local or on your own server
(PocketBase), with up to ten profiles. Source and IPTV connections are
account-wide; players and sync plugins are device-wide. A server account syncs
by pushing the journal, then reading the whole account. An encrypted
`.scbackup` file carries a local account between devices, and players are
plugins.

What runs today:

- One optional account per device, with log-based sync, sealed passwords and
  owner proofs. Your own server is the Node server in
  `../streaming_center_sync`, created from the app with an invite.
- Three tabs, and Settings → Plugins as one list.
- Real titles from every live source, merged — Jellyfin the first — and kept
  across restarts where the source allows it.
- SQLite and the keychain on phones, which run development builds
  (`modules/key-derivation`); IndexedDB with WebCrypto-encrypted secrets on
  the web.
- Nothing plays, and Videos still shows skeletons.
- vitest covers the database on both engines, the services, and two devices
  syncing on every pair of engines.

Documentation in `docs/` describes the target, not the present. When you build
something, update the matching doc in the same commit.

## Git

This repository has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
