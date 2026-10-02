# Loge — the app

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
npm install          # the adapters are workspaces here; nothing else to link
npm run ios          # or: npm run android, npm run web
npm run ios:device   # your own iPhone: a Release build, nothing tied to this computer
```

On a simulator or the emulator this builds a development client first — the
app carries native code, mpv's engine among it — so the first run takes
several minutes. After that, changes to the JavaScript load as usual. A phone
you carry gets the Release build instead: the JavaScript inside it, and
nothing that keeps the phone talking to this computer. The web needs no
build.

The first launch asks how to begin: create an account on this device, sign in
to your own server, or restore a backup. To try it against your own Jellyfin
server, add it once in Settings → Adapters → Sources → Jellyfin: its address and
an account. The app keeps it, like everything else. In a browser, open the app
from `localhost` — `docs/getting-started/` explains why.

Until the code catches up with the design (below), the first launch offers to
sign in or to use the device on its own, and Jellyfin sits directly under
Settings → Adapters.

## How it is put together

Four ideas, and the rest follows from them.

**The app has its own vocabulary.** It knows what a film is, what a profile is,
what "halfway through episode 3" means. Every server it talks to gets translated
into that vocabulary at the edge. The home screen has never heard of Jellyfin.

**Everything it talks to is an adapter, and adapters are kept at arm's
length.** They live in `adapters/`, as workspaces of this package, compiled as
programs of their own so the app cannot accidentally grow a dependency on one
— nor they on it. There are four kinds: *sources* bring your media, *IPTV*
brings a provider's live channels, films and series, *players* play them, and
*sync* decides where your account lives. Adding Plex should mean one new folder
under `adapters/sources/` and one line in the composition root. The app only
shows the adapters that work on the device you are holding.

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
[PocketBase](https://pocketbase.io), set up by `../foyer`. On
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

It runs on Apple TV too, from the same code — `npm run tvos` builds it for the
simulator — sized for a room and driven by the remote. Android TV is next.

## Current state

**Phase 7 — it plays. Phase 8 brings more players.** Everything above is
the design, and most of it runs today, built with
[Tamagui](https://tamagui.dev):

- **Four tabs.**
  - **Media** — films and series from every source, as one library: what you
    are in the middle of, then a row per kind in the order and sort you choose,
    a full-screen grid behind each row, and a page for every film, series,
    season and episode. Jellyfin is the first real source.
  - **Videos** — web video and plain files, one tab per source. No source
    lists them yet.
  - **Settings** — the account, profiles, PIN lock, and the plugins in five
    lists — Sources, IPTV, Players, Sync, Metadata — showing only those that
    run on this device. Connect a source through a form the plugin itself describes, and
    decide what each profile keeps for itself.
- **One account per device,** kept on the device or on your own server —
  PocketBase, in `../foyer`. On your server, profiles, PINs,
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
- **Press Play** on a film or an episode from Jellyfin — on a phone, which
  turns the player with the device, or in a browser — and pick up where you
  left off. Progress and "watched" go back to the server, offline too: they
  are written on the device first and delivered when it can. The controls are
  the app's own, the same behind every engine: chapters, Skip intro, the next
  episode when it is due, speed, volume and brightness on the edges of the
  picture, and picture in picture. mpv plays too, on Android and iPhone alike
  — the files the built-in player cannot, like Matroska with DTS, as they are
  — and each device chooses which player goes first, on each tab if you like;
  "Play with…" on a film or an episode picks one for it.
- **Live TV** on the TV tab, from a Stalker portal: channels in their groups
  with what is on now and next, a day's guide, channel up and down, and the
  provider's films and series.
- **Search**, on Media, Videos and TV — each box searching what is in front
  of you, never everything at once. It starts once typing stops for two
  seconds, or at once on the search key; on Videos, where each search is a
  request to the source, on the search key alone.
- **Not yet:** M3U and Xtream, Plex and Emby, the drives, and downloads.
  KSPlayer is a manifest with no engine behind it.

Development builds also have a pretend account, for trying things offline.

## Documentation

`docs/` is broken down by topic — getting started, architecture, platforms, UI,
playback, data, adapters, development. Each folder explains what belongs there.

The full architecture, with the reasoning, is in
[`../.claude/architecture.md`](../.claude/architecture.md).

`CLAUDE.md` and `AGENTS.md` are written for AI coding assistants — denser, and
full of rules. This file is the one written for you.

---

## Licence

**GPL-3.0-or-later.** The app is free software, and it links players built
from FFmpeg and mpv that are GPL themselves. That means anyone you give a
build to may have its source, and the same freedoms.
