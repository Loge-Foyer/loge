# Loge — plugins

Everything the app plugs into, and the language they speak.

---

## The idea

The app itself does not know how to talk to a Jellyfin server. It does not know
what a Plex library looks like, how a Stalker portal hands out a channel, how
to decode an MKV file, or where iCloud keeps a file. That is deliberate, and it
is the whole point of this repository.

Each of those is a **plugin**: a self-contained folder that knows one service
or one engine inside out and translates it into the app's own vocabulary. The
app only ever sees the translation.

The payoff is that adding a new service should be one new folder here plus one
line registering it — not a redesign of the home screen. If it ever costs more
than that, something shared is wrong, and that is what should be fixed.

## Five kinds of plugin

Every plugin does one job, and lives in the folder for that job:

| Folder | What its plugins do | Travels with | Examples |
| --- | --- | --- | --- |
| `adapters/sources/` | bring your films, series, videos and files | the account | Jellyfin, Plex, Emby, WebDAV, iCloud Drive, Google Drive, OneDrive, Yattee, Invidious |
| `adapters/iptv/` | bring live TV — and a provider's films and series | the account | M3U playlists, Stalker portals, Xtream Codes |
| `adapters/players/` | play it | the device | the phone's or browser's own player, KSPlayer, mpv, VLC |
| `adapters/sync/` | keep the account somewhere | the device | your own server; a backup in iCloud, Google Drive or OneDrive |
| `adapters/metadata/` | say what a film or series is, by its name | the account | TMDB, with your own key |

The app's Settings has the same five lists, and shows only the plugins that
work on the device in your hand: iCloud on an iPhone, not in a browser.

A service that does two jobs is two plugins. Google Drive can hold your films
*and* keep your backup. So there is `sources/google-drive`, and there is
`sync/google-drive`, and adding one never switches on the other.

## Account-wide or device-wide

Sources, IPTV and metadata belong to the account. Add Jellyfin once and every
device on the account has it — for every profile, or with each profile's own
sign-in. A TMDB key the same.

Players and sync belong to each device. Your phone may play MKV files with mpv
while the browser uses its own player; one device may keep its backups in
iCloud and another nowhere.

## Where your viewing history lives

A media server already knows what each of its users watched. So for anything
from Jellyfin, Emby or Plex, **the server stays the master**: the app reads it
from there and keeps a cache, and — once it can play — reports your progress
back. The Jellyfin web client and the app always agree.

Everything else the app knows — your profiles, their preferences, your sources
— belongs to **the account**: on the device alone, or on your own server,
which keeps it in step between devices. So does what you watched on a source
that keeps nothing of it — an IPTV provider's films, web video — keyed by what
it is. A portal that keeps a copy of a film for each language rarely says
which film it is; a metadata plugin — TMDB — does, so watching the German copy
checks the English one too.

## Plugins say what they can do

A plugin states plainly what it can do, and the app asks it for exactly that.
Nothing is silently dropped, and no plugin is asked to pretend.

This is the part that matters most to get right. A plugin that claims it can do
something and then quietly doesn't causes the worst kind of bug — a row that
never fills, a setting that does nothing, and nothing reports an error.

## `api`

The shared vocabulary. What a film is, what a profile is, what a channel is,
what watch progress means, and the contracts every plugin implements.

It depends on nothing at all — not React, not Expo, not the app. That is what
lets the app and a few dozen plugins agree without any of them knowing about
each other. A plugin cannot even reach the network by itself: the app hands it
an HTTP client, a place for its session token, a view of the network and its
cryptography, which keeps secrets and logging in one place.

Players are the exception that proves the rule. They have to draw video, so
they may use React, React Native and native code. The React half of their
contract lives in `player-kit`, next to `api`, so `api` itself stays free of
it.

## Current state

**Phase 6 moved the code to the new architecture; Phase 7, playback, is
under way.** The plugins are in their five folders, each with an id that names
its category, and every manifest declares one block.

What is real today:

- **Jellyfin** signs in and lists films and series in any order.
  - Libraries can be limited to some, or all but some, and it pages across
    them.
  - It opens detail pages with cast and studios, lists seasons and episodes,
    knows what each user watched, and builds artwork addresses.
  - It plays: the server picks the file itself or a transcode for the chosen
    player, and progress and watched go back to it.
  - It is tested against recorded server answers, and has been run against a
    real Jellyfin 12 server.
- **The mock source** has a fixed catalogue behind the same contract, so the
  app works fully offline, and **the mock portal** does the same for live TV:
  channels in groups, a guide, a few films and series.
- **Your own server** (`sync/custom-server`) is a working account on
  PocketBase: it signs in, reads the whole account and writes it back record
  by record, and creates an account with an invite.
- **The mock account** plays at being your own server, in memory, and **the
  mock backup target** at being a cloud folder.
- **Stalker** reaches a portal as a MAG box does: live channels with their
  guide, films and series, and a link made when something plays.
- **The built-in player** plays through expo-video on phones and the
  browser's `<video>` on the web, with hls.js fetched only when a browser has
  no HLS of its own. Its profile per platform says what each plays.
- **TMDB** (`metadata/tmdb`) says which film or series a title is, with the
  household's own key — a name in any language TMDB knows, within a year
  either side, and nothing where it is not sure. Tested against recorded
  answers, and run against TMDB itself.
- **Every other plugin** still describes itself with a manifest, and declares
  nothing it cannot do yet.

The contracts for what comes next are written too:

- what to play, the player that plays it, and its view (`player-kit`)
- progress and played state, back to the source
- live TV
- a place to keep a backup

Phase 4's roles, its change log and its sealed passwords are retired.

## Documentation

`docs/` covers the API, the five categories, writing a plugin, the capability
model, settings, testing and publishing.

The full architecture is in
[`../../.claude/architecture.md`](../../.claude/architecture.md).

---

## Licence

**AGPL-3.0-or-later**, with the app (`../LICENSE`, `../NOTICE`). `api` and
the adapters are free software. The player adapters link engines — FFmpeg,
mpv, libVLC — and mpv's build is GPL-3.0, which the AGPL is allowed to combine
with.
