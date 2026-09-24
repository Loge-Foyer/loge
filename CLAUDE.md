# CLAUDE.md — streaming_center_plugins

Every adapter Streaming Center has to the outside world, plus `plugin-api` —
the vocabulary the app and all plugins are written in.

## Reading protocol — before you plan, edit or run anything

1. `../.claude/streaming-center-architecture.md` — the architecture
   specification. Sections 7 and 8 define the two plugin contracts.
2. `../CLAUDE.md` — how the three repositories relate.
3. `AGENTS.md` here — imported below, read it fully.
4. `docs/` for the area you are touching, then the target package's `README.md`.

Only then start work.

@AGENTS.md

## Why this repository is the centre

`plugin-api` is what the app and every plugin agree on. Both sides need
`MediaItem`, `GlobalMediaKey` and the capability types, so those cannot live in
the app — that would make plugins depend on the app and the dependency graph
circular.

So this repository depends on nothing, and everything else points at it. Keep it
that way. An `import` of React, Expo or the app anywhere in `plugin-api` breaks
the property the whole split exists to provide.

## The mistake that costs the most

**Overstating a sync plugin's capabilities.** The sync engine filters the change
journal by what you declare it can carry. Claim you handle watch progress when
you do not, and the engine hands you those changes, you drop them, and the
checkpoint advances past them. The state is gone, nothing errors, and it
surfaces weeks later as "my progress disappeared."

Declare honestly. It is better to carry less than to pretend.

## The second mistake

**Letting an external type escape.** A Jellyfin response shape in a return value
means the app now knows about Jellyfin, and every later plugin has to imitate
its quirks. Map inside the package, always.

## Order of work

`plugin-api` first. It is empty, and nothing else can be built correctly until
the vocabulary exists. Then `media/mock`, because it is how the app gets built
without a real server — and it should deliberately *not* support every
capability, so the app's capability handling stays genuinely exercised.

Then Jellyfin, which is the real target and the true test of the abstraction.

## Current state

Skeleton. Thirteen packages, each a `package.json`, an `export {}` and a README.
No implementation anywhere, including `plugin-api`.

## Git

This repository has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
