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
in one transaction, then return. The sync engine drains the journal later.

## Current state

First pass. This is the unmodified `create-expo-app` template plus
documentation — `src/app/index.tsx` and `src/app/explore.tsx` are still the
template's demo screens. Nothing in the architecture is implemented.

Documentation in `docs/` describes the target, not the present. When you build
something, update the matching doc in the same commit.

## Git

This repository has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
