---
name: sc-use-plugin
description: Wire a Streaming Center plugin from the plugins repository into the app — the file dependency at its category path, the Metro watch folder, the registration line at the composition root, the platform filter, account-wide or device-wide scope, per-profile connection values, effective capabilities on resolved values, and how each category's role is called (media, player, account, backup). Use when connecting, registering or debugging a plugin inside the app.
---

# Using a plugin in the app

Plugins live in a **separate repository** (`../streaming_center_plugins`), so
npm workspaces cannot reach them. This is the fiddliest seam in the project.

**Phase 5 — the new architecture is written down; the code is still Phase 4's
until Phase 6.** This skill describes the target. Where today differs, it says
so; "Current state" at the end has the rest.

## 0. Install the plugins repository first

```bash
cd ../streaming_center_plugins && npm install
```

Plugin files resolve `@sc/api` from that repository's `node_modules`. Skip it
and both `tsc` and Metro fail to resolve `@sc/api` from inside a plugin.

## 1. Know its category

Every plugin has exactly one category, which is its folder, the first half of
its id, and the one block its manifest declares:

| Category | Folder and id | Block | Role it exports | Scope |
| --- | --- | --- | --- | --- |
| sources | `plugins/sources/<name>`, `sources/<name>` | `media` | `plugin.media` | account |
| IPTV | `plugins/iptv/<name>`, `iptv/<name>` | `media`, with `live` among its kinds | `plugin.media` | account |
| players | `plugins/players/<name>`, `players/<name>` | `player` | `plugin.player` | device |
| sync | `plugins/sync/<name>`, `sync/<name>` | `account` or `backup` | `plugin.account` or `plugin.backup` | device |

`validateManifest` refuses a manifest with the wrong block for its category, an
unknown platform, or an id that is not `<category>/<name>`. A service with two
jobs is two plugins — Google Drive's files are `sources/google-drive`, its
backups `sync/google-drive` — and the app wires each on its own. Never look for
one plugin that does both.

## 2. Depend on it

```jsonc
// package.json — edit by hand; `npx expo install` has nothing to pick for file: deps
"dependencies": {
  "@sc/api": "file:../streaming_center_plugins/api",
  "@sc/player-kit": "file:../streaming_center_plugins/player-kit",
  "@sc/source-jellyfin": "file:../streaming_center_plugins/plugins/sources/jellyfin"
}
```

Package names follow the folders: `@sc/source-<name>`, `@sc/iptv-<name>`,
`@sc/player-<name>`, `@sc/sync-<name>`. Until Phase 6 regroups them, a plugin
is `@sc/plugin-<id>` at `plugins/<id>`, and `player-kit` does not exist yet.

Then `npm install`. npm links the folders and never looks inside link targets
outside the project, so it never reaches for a registry.

Every plugin declares `@sc/api` as a **peer** dependency — players
`@sc/player-kit` too — so the app supplies the one copy, and a `PluginId` from a
plugin and one from the app are the same type. `npm ls --all` still prints
`UNMET DEPENDENCY @sc/api@*` under each linked plugin — npm does not resolve
dependencies of links outside the root. That line is cosmetic; `npm ls @sc/api`
should show the single top-level link.

## 3. Let Metro see it

```js
// metro.config.js — the whole of it
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../streaming_center_plugins')];
```

Metro only serves files under the project root or a watch folder. Nothing else
is needed: babel-preset-expo imports its runtime helpers by absolute path, so
plugin files never have to resolve `@babel/runtime` themselves (checked in dev
and production bundles for iOS and web).

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
them into Settings → Plugins' four lists. Nothing else in the app changes —
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
`if (pluginId === …)`. (Until Phase 6 the same job is done over Phase 4's
roles.)

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
| `playback` | `getPlaybackDescriptor` (Phase 7) |
| `watchStateWrite` | reporting playback and played state, through the outbox (Phase 7) |

The plugins repository's conformance test enforces it, and the media service
reports a missing member as `INVALID_STATE`.

Screens never call a provider. They read `useHomeRowQueries`, `useGrid`,
`useItem` and friends (`src/hooks/use-media.ts`), which go through the media
service: merged across sources, failures returned as `sourceErrors`, parking
and retry handled there.

## 8. How a player is used (Phase 7 and 8)

`plugin.player.create(context)` makes a `MediaPlayer` — `load`, `play`,
`pause`, `seek`, the track setters, `subscribe`, `dispose` — and the plugin's
`PlayerView`, from `@sc/player-kit`, draws it. Both are imported in
`src/composition/` only; the player screen gets the chosen player's controller
and view from the service graph. The context resolves a stream's `headersRef`
at load time, in memory only.

- **Which player** is `choosePlayer` from `@sc/api`: the device's default if it
  can play one of the item's sources, else the first enabled player on this
  platform that can, else none — and the app says what would. The candidates
  are the enabled players whose manifest runs here, each with its
  `PlayerProfile` for this platform.
- **Native code.** A player's engine — expo-video, or an Expo module in its own
  package — has to be autolinked into the development build from its
  `file:`-linked package. That is unproven: Phases 7 and 8 open with a spike,
  and whatever it settles (the engine as the app's own dependency, or linked
  from the plugin) goes here. Registering or changing a player means
  `npm run android` / `npm run ios` again.
- **The app never imports an engine itself.** expo-video belongs to
  `players/system`.

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

In the web source map, each `streaming_center_plugins/api/src/*` file must
appear exactly once — two copies would mean two brands and two vocabularies.
A player plugin is only proven by a development build on a phone, playing.

## Current state

Ten plugins are linked and registered as `@sc/plugin-<id>` (`mock` in
development builds only), in one flat folder, with unqualified ids and
Phase 4's roles. Jellyfin and the mock implement the media role — browse,
libraries, watch status read, and (Jellyfin) remote images and offline
metadata. The mock and your own server (`custom-server`) are Phase 4's
accounts: synced through a log, with sealed passwords, the password as owner
proof, and sign-up with an invite. The rest export manifests only: the app
lists them, installs them on the device and configures connections, and says
plainly that they cannot list titles yet. No player, IPTV or backup plugin is
wired, and nothing plays. Phase 6 moves all of it onto the categories above.
