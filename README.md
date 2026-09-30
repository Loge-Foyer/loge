# Streaming Center — the app

The client itself. Everything you see and tap.

It runs on iPhone, on Android, and in a browser, from one codebase. Built with
Expo and React Native.

---

## What it is for

You have films and shows somewhere — a Jellyfin server in a cupboard, a Plex
library, a folder on a NAS, a Yattee or Invidious instance, an IPTV
subscription. Each of those has its own app, and they all present your
collection differently.

This is one app for all of them. Same rows, same detail pages, same search, same
sense of where you got to — regardless of which machine the file actually lives
on. You should not have to think about which server something came from unless
you want to.

## Running it

```bash
(cd ../streaming_center_plugins && npm install)   # the plugins, which the app links to
npm install
npm run ios       # or: npm run android, npm run web
```

On a phone or simulator this builds a development client first — the app
carries native code, and will carry more once it plays video — so the first run
takes a few minutes. After that, changes to the JavaScript load as usual. The
web needs no build.

The first launch asks how to begin: create an account on this device, sign in
to your own server, or restore a backup. To try it against your own Jellyfin
server, add it once in Settings → Plugins → Sources → Jellyfin: its address and
an account. The app keeps it, like everything else. In a browser, open the app
from `localhost` — `docs/getting-started/` explains why.

Until the code catches up with the design (below), the first launch offers to
sign in or to use the device on its own, and Jellyfin sits directly under
Settings → Plugins.

## How it is put together

Four ideas, and the rest follows from them.

**The app has its own vocabulary.** It knows what a film is, what a profile is,
what "halfway through episode 3" means. Every server it talks to gets translated
into that vocabulary at the edge. The home screen has never heard of Jellyfin.

**Everything it talks to is a plugin, and plugins live somewhere else.** They
are in a separate repository entirely, so the app cannot accidentally grow a
dependency on one. There are four kinds: *sources* bring your media, *IPTV*
brings a provider's live channels, films and series, *players* play them, and
*sync* decides where your account lives. Adding Plex should mean one new
folder over there and one line here. The app only shows the plugins that work
on the device you are holding.

**Your data is yours and it is local.** What you have watched, what you have
favourited, where you got to — the app keeps its own copy in a local database.
That is why favouriting works in airplane mode and your history survives a
server going down. Where a server already keeps that record, as Jellyfin does,
the server stays the authority and the app's copy is a cache that works
offline; for plain files and web video, the app's copy is the record.

**One account, and profiles that are real.** A device holds one account, and
the account holds the household: up to ten profiles, and the sources everyone
shares. Profiles are not a colour scheme — genuinely separate preferences,
history and favourites, enforced by the database rather than by remembering to
filter. A source is set up once for the whole account, which is what a
household with one media server wants. Each connection then decides what every
profile keeps for itself — nothing, its own sign-in, or everything, down to
which libraries it shows — and a connection can be switched off for a profile
entirely. A PIN keeps a profile, and its sign-ins, for its owner.

## Your account

The account lives on this device alone, or on a server you run yourself —
[PocketBase](https://pocketbase.io), set up by `../streaming_center_sync`. On
your server, every device signed in to the account stays in step: profiles,
PINs, settings and sources, with their passwords, so nobody types the Jellyfin
password twice. Your server keeps those passwords readable, for now. It is
yours, so keep it private, and behind TLS anywhere but your home network.

Some things stay with each device, whatever the account: which players it uses,
and how it syncs or backs up.

Changing account replaces what is on the device; two accounts are never mixed.
Signing in to another account asks first, and offers to export a backup before
anything goes. Creating an account on your server takes this device's profiles
and sources up with it. Signing out keeps a copy here.

**Backups.** An account can be exported as one file — encrypted, with every
password and PIN inside — and opened on another phone or browser with its
backup key. Later, the app will keep that file in iCloud, Google Drive or
OneDrive by itself. A backup is a copy, not sync: for devices that stay in
step, use your server.

## Platforms

iOS, Android and web are all first-class. On a phone the tab bar and headers
are the platform's own; in a browser the tabs become a top navigation bar. The
web keeps its data in the browser's own database rather than SQLite, so it runs
from any static host with no special headers — see `docs/platforms/web/`.

Not every plugin runs everywhere, and the app only lists those that run here:
iCloud is an iPhone thing, and IPTV runs on phones, because most providers do
not let a browser talk to them.

TV layouts are a later goal. The design system is built so those would be new
screens rather than a new app.

## Current state

**Phase 6 — the code is moving to the new architecture.** Everything above is
the design. What runs today, built with [Tamagui](https://tamagui.dev):

- **Four tabs.** TV shows the way to add an IPTV source; its channels arrive
  with Phase 7.
  - **Media** — films and series from every source, as one library: what you
    are in the middle of, then a row per kind in the order and sort you choose,
    a full-screen grid behind each row, and a page for every film, series,
    season and episode. Jellyfin is the first real source.
  - **Videos** — web video and plain files, one tab per source. No source
    lists them yet.
  - **Settings** — the account, profiles, PIN lock, and the plugins in four
    lists — Sources, IPTV, Players, Sync — showing only those that run on this
    device. Connect a source through a form the plugin itself describes, and
    decide what each profile keeps for itself.
- **One account per device,** kept on the device or on your own server —
  PocketBase, in `../streaming_center_sync`. On your server, profiles, PINs,
  settings and sources — their passwords too — stay in step between devices.
  Signing in replaces what the device held; creating an account there, with
  an invite, takes the device's along. Up to ten profiles, or what your server
  allows. A forgotten PIN is reset by confirming it's you: with the account's
  password, or with Face ID, a fingerprint or the passcode.
- **Everything is kept on the device**: in SQLite and the keychain on a phone,
  in the browser's own database with the secrets encrypted on the web. What
  the servers answered is kept too, where they allow it, so the home shows up
  at once when the app opens, and still shows — saying how old it is — when a
  server cannot be reached.
- **A backup file** carries the account between devices — exported through
  the share sheet or as a download, and imported with its key — and backup
  targets keep it saved as the account changes, asking before they overwrite
  a file another device changed.
- **Not yet:** nothing plays.

Development builds also have a pretend account, for trying things offline.

## Documentation

`docs/` is broken down by topic — getting started, architecture, platforms, UI,
playback, data, plugins, development. Each folder explains what belongs there.

The full architecture, with the reasoning, is in
[`../.claude/streaming-center-architecture.md`](../.claude/streaming-center-architecture.md).

`CLAUDE.md` and `AGENTS.md` are written for AI coding assistants — denser, and
full of rules. This file is the one written for you.
