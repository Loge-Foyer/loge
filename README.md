# Streaming Center — the app

The client itself. Everything you see and tap.

It runs on iPhone, on Android, and in a browser, from one codebase. Built with
Expo and React Native.

---

## What it is for

You have films and shows somewhere — a Jellyfin server in a cupboard, a Plex
library, a folder on a NAS, a Yattee or Invidious instance. Each of those has its
own app, and they all present your collection differently.

This is one app for all of them. Same rows, same detail pages, same search, same
sense of where you got to — regardless of which machine the file actually lives
on. You should not have to think about which server something came from unless
you want to.

## Running it

```bash
npm install
npm run ios       # or: npm run android, npm run web
```

## How it is put together

Four ideas, and the rest follows from them.

**The app has its own vocabulary.** It knows what a film is, what a profile is,
what "halfway through episode 3" means. Every server it talks to gets translated
into that vocabulary at the edge. The home screen has never heard of Jellyfin.

**Servers are plugins, and they live somewhere else.** They are in a separate
repository entirely, so the app cannot accidentally grow a dependency on one.
Adding Plex should mean one new folder over there and one line here.

**Your data is yours and it is local.** What you have watched, what you have
favourited, where you got to — the app keeps its own copy in a local database.
That is why favouriting works in airplane mode and your history survives a
server going down. Sending that record anywhere else is optional and separate.

**Profiles are real.** Not a colour scheme — genuinely separate preferences,
history, connections and favourites, enforced by the database rather than by
remembering to filter.

## Platforms

iOS, Android and web are all first-class. Web is the newest and the least
settled: the local database runs as WebAssembly in the browser, which Expo still
labels alpha and which needs particular headers from whatever serves the page.
`docs/platforms/web/` is where that gets worked out.

TV layouts are a later goal. The design system is built so those would be new
screens rather than a new app.

## Current state

**Skeleton.** This is a fresh Expo project with documentation. The screens are
still the template's demo screens; none of the architecture above is built yet.

## Documentation

`docs/` is broken down by topic — getting started, architecture, platforms, UI,
playback, data, plugins, development. Each folder explains what belongs there.

The full architecture, with the reasoning, is in
[`../.claude/streaming-center-architecture.md`](../.claude/streaming-center-architecture.md).

`CLAUDE.md` and `AGENTS.md` are written for AI coding assistants — denser, and
full of rules. This file is the one written for you.
