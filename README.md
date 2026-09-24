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

## Two kinds of plugin

**Media plugins** give you something to watch.

| Plugin | What it connects to |
| --- | --- |
| `jellyfin` | Self-hosted film and TV server. The main target |
| `plex` | Plex Media Server |
| `emby` | Emby server, closely related to Jellyfin |
| `yattee` | Yattee Server — YouTube and web video |
| `invidious` | Invidious, a privacy-respecting YouTube front end |
| `webdav` | Plain files on a NAS, over WebDAV |
| `mock` | A pretend server, so the app can be built with no network at all |

**Sync plugins** carry *your* state somewhere else — what you watched, where you
got to, what you favourited.

| Plugin | Where your state goes |
| --- | --- |
| `local` | Nowhere. It stays on the device |
| `icloud` | Between your own Apple devices |
| `google` | The Android counterpart |
| `custom-server` | A small server you run yourself |
| `jellyfin` | Back to your Jellyfin server |

## Why Jellyfin appears twice

Because they are genuinely two different jobs. One teaches the app to *read a
library*. The other teaches it to *store your viewing state*. Keeping them
apart is what allows the arrangement most people actually want: films from your
Jellyfin server, viewing history backed up to iCloud.

If they were one piece, choosing Jellyfin for films would force it for
everything.

## Not every destination can hold everything

A Jellyfin server has somewhere to put "watched up to 42 minutes". It has
nowhere sensible to put "this person prefers dark mode". iCloud can hold both.

So every sync plugin states plainly what it can carry, and the app sends it only
that. Nothing is silently dropped, and no destination is asked to pretend.

This is the part that matters most to get right. A plugin that claims it can
hold something and then quietly discards it causes the worst kind of bug — your
progress vanishes, and nothing reports an error.

## `plugin-api`

The shared vocabulary. What a film is, what a profile is, what watch progress
means, and the contracts every plugin implements.

It depends on nothing at all — not React, not Expo, not the app. That is what
lets the app and a dozen plugins agree without any of them knowing about each
other.

## Current state

**Skeleton.** Thirteen folders, each with a README saying what will go in it,
and no code — including `plugin-api` itself.

`plugin-api` comes first. Nothing else can be built properly until the shared
vocabulary exists.

## Documentation

`docs/` covers the plugin API, writing each kind of plugin, the capability
model, testing and publishing.

The full architecture is in
[`../.claude/streaming-center-architecture.md`](../.claude/streaming-center-architecture.md).
