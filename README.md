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

A service can do two different things for you. Jellyfin can *serve your films*,
and it can *remember what you watched*. Those are genuinely different jobs, but
they are the same server, with the same address and the same password.

So there is one Jellyfin plugin, and it does both. Which of them it actually
does is up to you.

| Plugin | Can serve media | Can hold your state |
| --- | :---: | :---: |
| Jellyfin, Emby, Plex | ✓ | ✓ |
| iCloud, Google | ✓ — files on Drive | ✓ |
| Yattee, Invidious, WebDAV | ✓ | — |
| Your own sync server | — | ✓ |
| This device only | — | ✓ |
| Mock, for development | ✓ | ✓ |

## You decide what each one is allowed to do

This is the part that matters.

Connecting Jellyfin so you can watch your films does **not** mean your viewing
history starts going there. Every one of those switches starts off. You turn on
what you want.

Which means the arrangement most people actually want is just… a setting:

```
Jellyfin      films ✓    history ✗
iCloud        films ✗    history ✓
```

Films from the server in your cupboard. History backed up to iCloud. Neither
choice forces the other, and you can change your mind without disconnecting
anything.

## Not every destination can hold everything

A Jellyfin server has somewhere to put "watched up to 42 minutes". It has
nowhere sensible to put "this person prefers dark mode". iCloud can hold both.

So every plugin states plainly what it can carry, and the app sends it only
that. Nothing is silently dropped, and no destination is asked to pretend.

This is the part that matters most to get right. A plugin that claims it can
hold something and then quietly discards it causes the worst kind of bug — your
progress vanishes, and nothing reports an error.

## `api`

The shared vocabulary. What a film is, what a profile is, what watch progress
means, and the contracts every plugin implements.

It depends on nothing at all — not React, not Expo, not the app. That is what
lets the app and eleven plugins agree without any of them knowing about each
other.

## Current state

**Skeleton.** Twelve folders — `api` and eleven plugins — each with a README
saying what will go in it, and no code.

`api` comes first. Nothing else can be built properly until the shared
vocabulary exists.

## Documentation

`docs/` covers the API, writing a plugin, the two roles, the capability model,
settings, testing and publishing.

The full architecture is in
[`../.claude/streaming-center-architecture.md`](../.claude/streaming-center-architecture.md).
