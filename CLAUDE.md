# CLAUDE.md — streaming_center_plugins

Every adapter Streaming Center has to the outside world, plus `api` — the
vocabulary the app and all plugins are written in.

## Reading protocol — before you plan, edit or run anything

1. `../.claude/streaming-center-architecture.md` — the architecture
   specification. Section 7 defines the plugin model; section 8 is the roster.
2. `../CLAUDE.md` — how the three repositories relate.
3. `AGENTS.md` here — imported below, read it fully.
4. `docs/` for the area you are touching, then the target plugin's `README.md`.

Only then start work.

@AGENTS.md

## Why this repository is the centre

`api` is what the app and every plugin agree on. Both sides need `MediaItem`,
`GlobalMediaKey` and the capability types, so those cannot live in the app —
that would make plugins depend on the app and the dependency graph circular.

So this repository depends on nothing, and everything else points at it. An
`import` of React, Expo or the app anywhere in `api` breaks the property the
whole split exists to provide.

## One plugin per service

A plugin is defined by the **service** it talks to, not by what it does with it.
Jellyfin serves a library and holds viewing state — that is one package with two
roles.

Do not split a service into `jellyfin` and `jellyfin-sync`. If a service gains a
role, add it to the existing manifest.

## The mistake that costs the most

**Overstating a capability.** The sync engine filters the change journal by what
you declare it can carry. Claim you handle watch progress when you do not, and
the engine hands you those changes, you drop them, and the checkpoint advances
past them. The state is gone, nothing errors, and it surfaces weeks later as "my
progress disappeared."

Declare honestly. Carrying less is always better than pretending.

## The mistake that is new

**Branching on declared capabilities instead of effective ones.** A plugin
declares what it *can* do; the user decides per connection what it *may* do.
Effective = declared ∩ enabled, and that is what the app must read.

Every sync toggle defaults to **off**. Connecting Jellyfin for media must never
silently begin pushing watch state to it. That independence is the reason
merging the packages was safe in the first place.

## The third mistake

**Letting an external type escape.** A Jellyfin response shape in a return value
means the app now knows about Jellyfin, and every later plugin has to imitate
its quirks. Map inside the package, always.

## Order of work

`api` first — nothing else can be built correctly until the vocabulary exists.
The manifest half is written; the role contracts come next. Then `mock`, because it is how the app gets built without a
real server — and it carries both roles so syncing can be exercised too. It
should deliberately decline some capabilities, so the app's capability handling
stays genuinely tested.

Then Jellyfin, which is the real target and the true test of the abstraction —
and the first plugin to exercise both roles against a real service.

## Current state

`api` holds the manifest vocabulary (IDs, content kinds, capabilities, fields,
manifest, connection, effective roles, validation); the role contracts are not
written yet. Every plugin exports a manifest and nothing else — no role is
implemented, so no real plugin declares a capability. `npm test` runs the
effective-roles, validation and conformance tests.

## Git

This repository has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
