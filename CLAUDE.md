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

**Owns:** screens, navigation, the design system, application services, the
local database, platform access (keychain, biometrics), and the composition root
that wires everything together.

**Does not own:** domain types, plugin contracts, or any adapter. Those are in
`../streaming_center_plugins`. If you find yourself writing a `MediaItem`
interface here, stop — it belongs in `@sc/api`.

## The three mistakes to avoid

**Defining domain types here.** The app and every plugin both need them. Putting
them in the app makes plugins depend on the app, and the dependency graph goes
circular. This is expensive to undo later.

**Naming a plugin above the composition root.** An `if (providerId ===
'jellyfin')` in a screen means the abstraction has already failed. Branch on
capabilities.

**Reaching for the network in a write path.** Local database plus journal entry
in one transaction, then return. The sync engine drains the journal later. And
nothing but the database inside that transaction — not the keychain, not
WebCrypto: IndexedDB commits early, SQLite deadlocks.

## Current state

Phase 4 — your own server as the account. A device has at most one: Welcome
offers to sign in or to stay on this device, Settings → Account shows it and
switches or signs out, and the sync engine drains the change journal to it and
applies what it brings — profiles and their PINs, preferences, connections, and
their passwords sealed where the account carries them. A password is only ever
used with the sign-in it was saved for. The first real account is your own
server (`custom-server`, against `../streaming_center_sync`): created from the
app with an invite, signed in to once, and its password — typed again — is the
owner check for Forgot PIN, signing out and switching. The dev-only mock is
still there, and declines sealing; iCloud and Google come in Phase 5.
Everything from Phase 2 stands: real titles from every live source, merged,
kept across restarts in SQLite and the keychain, or IndexedDB and encrypted
secrets on the web. Plugins get the host's cryptography through their context —
native PBKDF2 among it — so phones run a development build, not Expo Go.
Nothing plays, and Videos still shows skeletons. vitest covers the database on
both engines, the services, and two devices syncing on every pair of engines.

Documentation in `docs/` describes the target, not the present. When you build
something, update the matching doc in the same commit.

## Git

This repository has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
