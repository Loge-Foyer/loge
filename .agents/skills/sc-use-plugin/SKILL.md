---
name: sc-use-plugin
description: Wire a Streaming Center adapter into the app — where the adapters live as npm workspaces, the registration line at the composition root, the platform filter, account-wide or device-wide scope, per-profile connection values, effective capabilities on resolved values, and how each category's role is called (media, player, account, backup). Use when connecting, registering or debugging an adapter inside the app.
---

# Using an adapter in the app

Adapters live in `adapters/`, in this repository, as **npm workspaces** of this
package. They were a repository of their own until Phase 9, and that seam —
`file:` dependencies, a Metro watch folder, a block list — is gone. If you find
instructions to `cd ../streaming_center_plugins`, they are from before the
move; that folder does not exist.

This skill describes the target. "Current state" at the end has what differs.

## 1. Know its category

Every adapter has exactly one category, which is its folder, the first half of
its id, and the one block its manifest declares:

| Category | Folder and id | Block | Role it exports | Scope |
| --- | --- | --- | --- | --- |
| sources | `adapters/sources/<name>`, `sources/<name>` | `media` | `plugin.media` | account |
| IPTV | `adapters/iptv/<name>`, `iptv/<name>` | `media`, with `live` among its kinds | `plugin.media` | account |
| players | `adapters/players/<name>`, `players/<name>` | `player` | `plugin.player` | device |
| sync | `adapters/sync/<name>`, `sync/<name>` | `account` or `backup` | `plugin.account` or `plugin.backup` | device |

`validateManifest` refuses a manifest with the wrong block for its category, an
unknown platform, or an id that is not `<category>/<name>`. A service with two
jobs is two adapters — Google Drive's files are `sources/google-drive`, its
backups `sync/google-drive` — and the app wires each on its own. Never look for
one adapter that does both.

## 2. Depend on it

```jsonc
// package.json — the workspace globs already cover the folder
"dependencies": {
  "@sc/api": "*",
  "@sc/player-kit": "*",
  "@sc/source-jellyfin": "*"
}
```

Package names follow the folders: `@sc/source-<name>`, `@sc/iptv-<name>`,
`@sc/player-<name>`, `@sc/sync-<name>`. Then `npm install`, which links them
into `node_modules/@sc/`.

Every adapter declares `@sc/api` as a **peer** dependency — players
`@sc/player-kit`, React, React Native and their engine too — so this package
supplies the one copy, and a `PluginId` from an adapter and one from `src/` are
the same type. **A player's peers are installed here**: `npx expo install
expo-video`, and `npm install` for a non-Expo one such as hls.js.

## 3. One copy of everything

One `node_modules` means one React, one React Native, one expo, one
expo-video. Nothing has to arrange it — which is most of why the adapters
moved in.

What still needs care is **native** code. A player's own Expo module lives in
its own package and is autolinked from the workspace link, so it is the one
native thing built from outside `node_modules`. Check after touching a player:

```bash
npx expo-modules-autolinking resolve --platform android --json
npx expo-modules-autolinking resolve --platform apple --json
```

Nothing may report a `sourceDir` under `adapters/` but a player's own module.
`expo.autolinking.searchPaths` pins this package's `node_modules` first, so its
copies win a tie — before that, autolinking once built another copy of
`expo-modules-core` under this app's JavaScript.

Where two engines carry the same native library, **the app settles it**: no
adapter can see what another adapter's engine put in the same build.
`config-plugins/with-newest-libcxx.js` is that rule in code.

**Check a bundle, not a typecheck:** `npx expo export --platform web
--source-maps`, then look through the maps' `sources` — one `react/index.js`,
and a player's `.web` files on the web, its native ones in an iOS export.

## 4. Register it — one line

`src/composition/plugins.ts` is **the only place** that imports a concrete
plugin, and lint enforces it. Every plugin exports the same name:

```ts
import { plugin as jellyfin } from '@sc/source-jellyfin';
// …and one entry in the `plugins` array
```

The catalogue validates every manifest at startup (`validateManifest`): it
throws in development and leaves the plugin out in production. It lists and
runs only plugins whose `platforms` include the one the app is on, and sorts
them into Settings → Adapters' four lists. Nothing else in the app changes —
Settings renders the new plugin's page, and its form, from its manifest.

## 5. Branch on category and effective capabilities — never a name

A plugin **declares** its capabilities, and its manifest's toggles gate some of
them. The user **switches** a connection on or off (`enabled`) and sets its
toggles, per connection and, under `perProfile: 'all'`, per profile. The app
reads the result of `effectiveCapabilities(manifest, { enabled, settings })`
from `@sc/api`, computed on the settings the active profile runs the
connection with — the sources service does this for every screen:

```
effective = nothing, when the connection is off
          = declared, less every capability a toggle gates that is off
```

Branching on declared alone calls features the user switched off — for
`offlineMetadata`, keeping titles and artwork on a device whose owner said not
to. Where content appears is category plus kind, in `services/tab-content.ts`
alone: a source's movies, shows and anime on Media; its videos and files on
Videos; everything IPTV brings, and a source's `live`, on TV. There is never an
`if (pluginId === …)`.

## 6. Know its scope

**Sources and IPTV are account-wide.** Their connections belong to the
account: journaled, carried to your server, written into backups, on every
device of the account. Adding a connection is what puts the plugin in use —
there is no install step. A connection whose plugin cannot run on this
platform stays inert, labelled "not available on this device", and is kept for
the devices that can.

Each connection's `perProfile` mode decides what a profile keeps for itself —
`none`, `credentials` (password fields and fields marked `credential: true`),
or `all` — and those values live in rows the profile owns. `resolveValues`
merges them over the shared ones; `services/sources.ts` gives each connection a
standing per profile: **live**, **pending** (its own values are not filled in:
the app offers "Finish setting up"), or **off** (the profile does not use it,
and is never asked). Under `all`, two profiles can run the same connection with
different settings, so always read capabilities from the resolved source,
never from the connection alone.

**Players and sync plugins are device-wide.** A player's switch, the default
and its settings, your server's sign-in, a backup target and its key are this
device's: never journaled, never pushed, never in a backup.

## 7. How the media role is called — sources and IPTV

`plugin.media.connect(target, context)` is called by `services/media/pool.ts`
and nothing else. The target is the resolved values for one credential scope;
the context (`services/plugin-context.ts`) carries every host service a plugin
may use — HTTP, the scope's credentials, its session token, the network kind,
a client identity, a clock and the host's crypto — because plugins have no host
globals. A declared capability means the provider implements its members:

| Capability | Members |
| --- | --- |
| `browse` | `listItems`, `getItem`, `getChildren` |
| `libraries` | `getLibraries` |
| `watchStateRead` | `getResume` |
| `remoteImages` | `resolveImage`, `resolveHeaders` |
| `channels` | `listChannelGroups`, `listChannels` |
| `epg` | `getGuide` |
| `playback` | `getPlaybackDescriptor` |
| `watchStateWrite` | reporting playback and played state, through the outbox (`services/watch/`) — never called from anywhere else |

The adapters' conformance test (`adapters/test/manifests.test.ts`) enforces
it, and the media service reports a missing member as `INVALID_STATE`.

Screens never call a provider. They read `useHomeRowQueries`, `useGrid`,
`useItem` and friends (`src/hooks/use-media.ts`), which go through the media
service: merged across sources, failures returned as `sourceErrors`, parking
and retry handled there.

## 8. How a player is used (Phase 7 and 8)

`plugin.player.create(context)` makes a `MediaPlayer` — `load`, `play`,
`pause`, `seek`, the track setters, `subscribe`, `dispose` — and the plugin's
`PlayerView`, from `@sc/player-kit`, draws it. A player plugin is imported in
`src/composition/` only, and listed there twice: in `plugins`, and — with its
engine and view — in `players`, which `PlaybackService` hands out. Anywhere
else `@sc/player-kit` is `import type` only (lint). The context resolves a
stream's `headersRef` at load time, in memory only.

- **Which player** is `choosePlayer` from `@sc/api`: the device's default if it
  can play one of the item's sources, else the first enabled player on this
  platform that can, else none — and the app says what would. The candidates
  are the enabled players whose manifest runs here, each with its
  `PlayerProfile` for this platform.
- **Native code.** expo-video is a published package: it is the built-in
  player's peer, the app installs it, and autolinking builds it from the app's
  `node_modules` — proven on Android in Phase 7. An Expo module in a player's
  own package (KSPlayer, mpv, VLC) is Phase 8's spike, and what it settles goes
  here. Registering or changing a player means `npm run android` /
  `npm run ios` again.
- **The app never imports an engine itself.** expo-video and hls.js belong to
  `players/system`; lint refuses them everywhere in `src/`, the composition
  root included.

## 9. How the account role is called — your own server

`plugin.account.connect(target, context)` is called by `services/sync/` and
nothing else: for the device's account, and once, outside any pool, to try a
sign-in before anything is saved. Its session is its own, apart from any media
connection. The engine pushes, then reads, then reconciles (`sync/engine.ts`);
screens read `useSyncStatus` and `useAccount`, and never call a provider.

Every connected account has `info` (the server's version, `maxProfiles`, how
it takes sign-ups — without signing in), `status` (signs in, once), `pull`
(every record, deleted ones included), `push` (one all-or-nothing batch) and
`dispose`. The manifest's `account` block decides the rest, with no plugin
named in the app:

- **`ownerProof`** — the owner check asks for those password fields again, in
  `OwnerProofForm`, and hands them to `verifyOwner(proof)`.
- **`signUp`** — "New here? Create an account" adds those fields, and the try
  calls `createAccount(fields, { firstProfile })` instead of `status()`:
  `true` from a fresh device, `false` when a local account is uploaded.
- **`signOut()`** — called once, for at most five seconds, when the device
  signs out or switches.

Passwords travel in the records' `secrets`, in plain text; the app reads them
from the keychain for a push and writes what arrives straight back into it.
Every pulled record is checked with `isAccountRecord`.

## 10. How a backup target is called

`plugin.backup.connect(target, context)` is called by `services/backup/` and
nothing else. A target only stores bytes: `stat`, `read`, `write(name, bytes,
ifMatch)`, `list`, `dispose`. The app builds and encrypts the file, and
remembers `{ lineage, generation, etag }` per target. A `write` with `ifMatch`
refuses with `SYNC_CONFLICT` when the file changed elsewhere, and the app then
asks — open theirs, keep this device's, or keep both. A target never sees a
password it could read, and is never live sync. iCloud, Google Drive and
OneDrive are later phases; `sync/mock-backup`, a pretend target in memory, is
there for development.

## Verifying it actually resolves

`tsc` is not enough. Metro resolution across a repository boundary (symlinks,
duplicate copies, hoisting) only fails in a real bundle:

```bash
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web --source-maps
```

In the web source map, each `adapters/api/src/*` file must appear exactly
once — two copies would mean two brands and two vocabularies. A player adapter
is only proven by a development build on a phone, playing.

## Current state

**Nineteen adapters are registered** in `src/composition/plugins.ts`
(`sources/mock`, `iptv/mock`, `sync/mock` and `sync/mock-backup` in
development builds only). Four packages exist and are deliberately *not*
registered: `sources/google-drive`, `sources/icloud-drive` and
`sources/onedrive`, which are not offered until they can do anything, and
`players/ksplayer`, which has no engine to register — it is on no package
manager, its own podspec pins a tag that does not exist, and its FFmpeg ships
only as a 670 MB clone.

Implemented roles:

- **media** — `sources/jellyfin` (browse, search, libraries, watch status both
  ways, remote images, offline metadata, playback with a `DeviceProfile` built
  from the chosen player's profile, chapters and media segments),
  `sources/mock`, `iptv/stalker` (channels, a guide, live links, films and
  series) and `iptv/mock`.
- **player** — `players/system` (expo-video on phones, `<video>` with hls.js
  and mpegts.js in a browser) and `players/mpv` (libmpv's C API, this
  project's JNI on Android and Swift on iOS).
- **account** — `sync/custom-server` on PocketBase, and `sync/mock`.
- **backup** — `sync/mock-backup`.

The rest export manifests only: the app lists them in their category and says
plainly that they cannot list titles, play or keep backups yet.
