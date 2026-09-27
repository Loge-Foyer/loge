# Streaming Center — plugins

Everything the app plugs into, and the language they speak.

---

## The idea

The app itself does not know how to talk to a Jellyfin server. It does not know
what a Plex library looks like, or how Invidious paginates, or how iCloud stores
things. That is deliberate, and it is the whole point of this repository.

Each of those is a **plugin**: a self-contained folder that knows one service
inside out and translates it into the app's own vocabulary. The app only ever
sees the translation.

The payoff is that adding a new service should be one new folder here plus one
line registering it — not a redesign of the home screen. If it ever costs more
than that, something shared is wrong, and that is what should be fixed.

## One plugin per service, not per job

A service can do two different things for you. iCloud can *hold your files*,
and it can *carry your profiles and settings* between your devices. Those are
genuinely different jobs, but they are the same account.

So there is one iCloud plugin, and it does both. Which of them it actually does
is up to you.

| Plugin | Can serve media | Brings | Can be your account |
| --- | :---: | --- | :---: |
| Jellyfin, Emby, Plex | ✓ | movies, shows | — |
| iCloud, Google | ✓ | files on Drive | ✓ |
| WebDAV | ✓ | files | — |
| Yattee, Invidious | ✓ | videos | — |
| Your own sync server | — | — | ✓ |
| This device only | — | — | ✓ |
| Mock, for development | ✓ | everything | ✓ |

What a plugin brings — movies, shows, anime, videos or files — is part of its
manifest. The app uses it to decide where things appear: films and series on
the Media tab, web video and plain files on the Videos tab.

## Where your viewing history lives

A media server already knows what each of its users watched. So for anything
from Jellyfin, Emby or Plex, **the server stays the master**: the app reads it
from there and keeps a cache, and — once it can play — reports your progress
back. The Jellyfin web client and the app always agree.

Everything else the app knows goes to **one account per device**: your profiles,
their preferences, the home screen layout, and history for things no server
tracks, such as plain files. That account is iCloud, Google, your own sync
server, or simply this device.

```
Jellyfin        films ✓    history: kept by the server
iCloud          account    profiles, preferences, the rest
```

## Not every account can hold everything

A plugin states plainly what it can carry, and the app sends it only that.
Nothing is silently dropped, and no destination is asked to pretend.

This is the part that matters most to get right. A plugin that claims it can
hold something and then quietly discards it causes the worst kind of bug — your
progress vanishes, and nothing reports an error.

## `api`

The shared vocabulary. What a film is, what a profile is, what watch progress
means, and the contracts every plugin implements.

It depends on nothing at all — not React, not Expo, not the app. That is what
lets the app and eleven plugins agree without any of them knowing about each
other. A plugin cannot even reach the network by itself: the app hands it an
HTTP client, a place for its session token and a view of the network, which
keeps secrets and logging in one place.

## Current state

**Jellyfin is real.** It signs in and lists films and series in any order.
Libraries can be limited to some, or all but some. It pages across them, opens
detail pages with cast and studios, lists seasons and episodes, knows what each
user watched, and builds artwork addresses. It is tested against recorded
server answers, and has been run against a real Jellyfin 12 server.

The **mock** has a fixed catalogue behind the same contract, so the app works
fully offline. Every other plugin still describes itself with a manifest and
declares nothing it cannot do yet.

The contract for an account is written too: what travels — profiles, their
PINs, preferences and connections, never passwords — and how a change reaches
every device exactly once, in one order.

Each plugin says what it needs to connect — a server address, a username, a
password — and the app builds its settings screen from exactly that, including
which fields each profile may keep for itself.

## Documentation

`docs/` covers the API, writing a plugin, the two roles, the capability model,
settings, testing and publishing.

The full architecture is in
[`../.claude/streaming-center-architecture.md`](../.claude/streaming-center-architecture.md).
