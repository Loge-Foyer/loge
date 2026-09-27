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
iCloud serves Drive files and can be the device's account — that is one package
with two roles.

Do not split a service into `jellyfin` and `jellyfin-sync`. If a service gains a
role, add it to the existing manifest.

Media servers (Jellyfin, Emby, Plex) are **media-only**. The server is the
master of what its users watched. The app reads it and writes progress back
through the media role, and a device's single sync connection — its account — is
never a media server.

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

A new connection's sync role is **off**, and only choosing it as the device's
account switches it on. Connecting Google Drive for its files must never
silently make it the place your profiles go. That independence is the reason
merging the packages was safe in the first place.

## The third mistake

**Letting an external type escape.** A Jellyfin response shape in a return value
means the app now knows about Jellyfin, and every later plugin has to imitate
its quirks. Map inside the package, always.

## Order of work

`api` first — nothing else can be built correctly until the vocabulary exists.
The manifest, the media contract and the sync contract are written. `mock` implements the media role so the app works offline,
and deliberately declines some capabilities so the app's capability handling
stays genuinely tested. Jellyfin is the first real media source.

## Current state

- **`api`:** the manifest vocabulary, per-profile values, the media contract,
  the sync contract — with sealed passwords, owner proofs and sign-up — errors,
  the HTTP port and the host's crypto port.
- **Jellyfin:** implements the media role, tested with a fake HTTP client and
  recorded 12.x payloads.
- **Mock:** implements the media role with a fixed catalogue, and the sync role
  as a pretend account in memory. It declines sealing on purpose.
- **Custom server:** implements the sync role against `streaming_center_sync` —
  sealed passwords, the owner proof, creating an account with an invite — and
  never signs itself back in after a 401.
- **Every other plugin:** a manifest.
- **`npm run typecheck`:** two programs — api and the plugins with no host
  types at all, and the tests with Node's.
- **`npm test`:** runs everything.
  - the api rules, bytes as text, and the sync wire
  - Jellyfin's behaviour: sign-in, local-only, paging, mapping
  - the mock, as a source and as an account
  - the custom server against a fake of the server's routes: keys, sessions,
    refusals, the log, the owner check, creating an account
  - the conformance check that each declared capability is implemented

## Git

This repository has **no remote and should not get one**. Commit here; never at
the workspace root. Conventional commit style.
