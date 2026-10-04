# Loge — the app

The client itself. Everything you see and tap.

It runs on iPhone, Android and Apple TV, and in a browser, from one codebase.
Built with Expo and React Native.

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

## How it is put together

Four ideas, and the rest follows from them.

**The app has its own vocabulary.** It knows what a film is, what a profile is,
what "halfway through episode 3" means. Every server it talks to gets translated
into that vocabulary at the edge. The home screen has never heard of Jellyfin.

**Everything it talks to is an adapter, and adapters are kept at arm's
length.** They live in `adapters/`, as workspaces of this package, compiled as
programs of their own so the app cannot accidentally grow a dependency on one
— nor they on it. There are five kinds:

- *sources* bring your media;
- *IPTV* brings a provider's live channels, films and series;
- *players* play them;
- *sync* decides where your account lives;
- *metadata* says which film or series a title is.

Adding Plex should mean one new folder
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
[Foyer](https://github.com/Loge-Foyer/foyer), which is
[PocketBase](https://pocketbase.io) with the account's collections added. On
your server, every device signed in to the account stays in step: profiles,
PINs, settings and sources, with their passwords, so nobody types the Jellyfin
password twice. Your server keeps those passwords readable, for now. It is
yours, so keep it private, and behind TLS anywhere but your home network.

Some things stay with each device, whatever the account: which players it uses,
how it syncs or backs up, and — where you choose — a profile's PIN: one for
every device, or this device's own, so the family's TV can ask for one that
your phone does not.

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

Not every adapter runs everywhere, and the app only lists those that run here:
iCloud is an Apple thing, and IPTV stays out of the browser, because most
providers do not let one talk to them.

It runs on Apple TV too, from the same code — `npm run tvos` builds it for the
simulator — sized for a room and driven by the remote. Android TV is next.

## Current state

**2026.10.1, the first version.** Everything above is the design, and most of
it runs today, built with [Tamagui](https://tamagui.dev):

- **Four tabs.**
  - **Media** — films and series from every source, as one library.
    - What you are in the middle of, then what this device keeps, then a row
      per kind in the order and sort you choose.
    - A full-screen grid behind each row.
    - A page for every film, series, season and episode.
    - Jellyfin is the first real source.
  - **Videos** — web video and plain files, one source at a time. Yattee
    Server is the first: what is trending, and a search for videos, channels
    and playlists. A channel has a page of its own.
  - **Live** — live channels from a Stalker portal.
    - Channels in their groups, with what is on now and next — each in its
      own country's time, even where the provider wrote one country's guide
      in UTC.
    - A day's guide, and a ★ of favourite channels.
    - The provider's films and series.
    - On a TV, a channel plays with the controls away: up and down zap, a
      banner says what is on, select brings the controls, and Back closes
      what is open before it leaves. A stream that stops comes back by
      itself.
  - **Settings** — the account, profiles and PIN lock, watch status, what the
    app does on this device, and downloads.
    - The adapters in five lists — Sources, IPTV, Players, Sync, Metadata —
      showing only those that run on this device.
    - Connect a source through a form the adapter itself describes, and decide
      what each profile keeps for itself.
- **One account per device,** kept on the device or on your own server —
  [Foyer](https://github.com/Loge-Foyer/foyer). On your server, profiles, PINs,
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
  the share sheet or as a download, and imported with its key. Keeping it in
  iCloud, Google Drive or OneDrive by itself comes later.
- **Press Play** on a film or an episode from Jellyfin — on a phone, which
  turns the player with the device, on Apple TV, or in a browser — and pick up
  where you left off. Progress and "watched" go back to the server, offline
  too: they are written on the device first and delivered when it can. The
  controls are the app's own, the same behind every engine: chapters, Skip
  intro, the next episode when it is due, speed, volume and brightness on the
  edges of the picture, and picture in picture.
- **mpv and VLC play too** — the files the built-in player cannot, like
  Matroska with DTS, as they are.
  - They play on Android today. They are built for iPhone and Apple TV, and
    wait for a real device there.
  - Each device chooses which player goes first, on each tab if you like.
    "Play with…" on a film or an episode picks one for it.
  - How far ahead they read is the device's too: off, in memory, or on disk
    up to a limit you set — mpv keeps it on disk, the others in memory.
- **Watch status for sources that keep none** — IPTV films and series, and
  web video — is kept by the app, on the account, for every device. With a
  TMDB key, the German and the English copy of a film share one record.
- **Downloads:** a copy of a film or an episode from Jellyfin, or of a Yattee
  video, kept on a phone and played with no network.
- **Search**, on Media, Videos and Live — each box searching what is in front
  of you, never everything at once. It starts once typing stops for two
  seconds, or at once on the search key; on Videos, where each search is a
  request to the source, on the search key alone.
- **Not yet:**
  - M3U and Xtream;
  - Plex, Emby and Invidious;
  - WebDAV and the drives;
  - backups kept in the cloud by themselves.

  KSPlayer is a manifest with no engine behind it.

Development builds also have a pretend account, source and IPTV portal, for
trying things offline.

## Documentation

`docs/` is broken down by topic — getting started, architecture, platforms, UI,
playback, data, adapters, development. Each folder explains what belongs there.

`docs/architecture/` explains how the pieces fit together, and why.

`CLAUDE.md` and `AGENTS.md` are written for AI coding assistants — denser, and
full of rules. This file is the one written for you.

---

## Licence

**AGPL-3.0-or-later.** The app is free software. Anyone may use it, change
it, and host it — for money too — as long as they give their users the
complete source, under the same licence.

- **Hosting counts.** Someone who runs a copy as a service for others, the
  web build included, owes those users its source. A renamed copy owes it
  just the same, and none may be closed.
- **The attribution stays.** One additional term (`NOTICE`, under the
  licence's section 7(b)): a work based on Loge keeps "Based on Loge" and a
  link to this repository wherever it shows its legal notices.
- **The engines fit.** It links players built from FFmpeg and mpv that are
  GPL-3.0 themselves, and the AGPL and the GPL allow exactly that
  combination.
