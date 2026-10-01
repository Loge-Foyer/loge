# Adapters

How the app discovers, registers and talks to its adapters, and how to work on
them. They live in `adapters/`, beside `src/`, as workspaces of this package.

This page describes the target. Several adapters are manifests with no role
behind them yet.

## Four categories

Every adapter has exactly one category, which is also its folder under
`adapters/` and the first half of its id: `sources/jellyfin`, `iptv/stalker`,
`players/system`, `sync/custom-server`.

| Category | Its contract | Scope | Where it shows |
| --- | --- | --- | --- |
| `sources` | the media role | account | Media (movies, shows, anime) and Videos (videos, files) |
| `iptv` | the media role, with live members | account | TV: Live, Movies, Series |
| `players` | the player role, with `@sc/player-kit`'s view | device | the player |
| `sync` | the account role (your own server) or the backup role (a file) | device | Settings → Account, and Sync |

A service with two jobs is two plugins in two folders: Google Drive's files
are `sources/google-drive`, and Google Drive as a place for backups is
`sync/google-drive`. They share no code, and the app treats them as strangers.

## Four lists

Settings → Plugins is four rows — Sources, IPTV, Players, Sync — and each opens
that category's list for this platform (`settings/plugins/[category]`). A
plugin's page is `settings/plugins/[category]/[name]`: the id's two parts are
the two route segments, so no id is ever URL-encoded. There is no global list.

- **Sources and IPTV** list their connections, each with an `enabled` switch,
  and add new ones.
- **Players** list this device's engines: each one's switch and settings, and
  the default.
- **Sync** has your own server, the backup targets, and the backup file.

## Account-wide or device-wide

| Category | Scope | What that means |
| --- | --- | --- |
| sources, IPTV | account | Connections belong to the account: journaled, carried to your server, written into backups. Every device on the account has them. |
| players | device | Which are on, the default and their settings are device settings. |
| sync | device | Your server's sign-in, a backup target and its key are this device's alone: never journaled, never pushed, never in a backup. |

## Only this platform's plugins

A manifest lists its `platforms` — `ios`, `android`, `web` — and the app lists
and runs only the plugins that include the one it is on (`runsOn` in
`@sc/api`). iCloud appears on iOS alone; IPTV is hidden on the web, where
portals send no CORS headers; KSPlayer is an iOS engine.

A connection on the account whose plugin cannot run here stays inert. It is
labelled "not available on this device", is never connected, and is kept as it
is for the devices that can run it. A stored plugin id says its category even
in a build without the plugin.

## Where the adapters live

They are in `adapters/`, in this repository, as **npm workspaces** of this
package: `adapters/api`, `adapters/player-kit`, and one folder per adapter at
its category path — `adapters/<category>/<name>`, named `@sc/source-<name>`,
`@sc/iptv-<name>`, `@sc/player-<name>` or `@sc/sync-<name>`. `npm install` here
links every one of them; there is nothing else to install.

They were a repository of their own between Phase 5 and Phase 9. The reason
was sideloading adapters written by other people, which phones cannot do. What
the split actually bought was a boundary the compiler and the linter already
enforce; what it cost was two `node_modules`, a Metro resolver rewriting every
import of every adapter file, a block list, and a duplicate-native-package
hazard that once built that repository's `expo-modules-core` 57.0.20 under
this app's 57.0.19. All of that machinery is gone.

**One copy of everything, by construction.** One `node_modules` means one
React, one React Native, one expo, one expo-video. Each adapter takes `@sc/api`
as a peer dependency — a player `@sc/player-kit`, React, React Native and its
engine too — and the workspace root supplies it.

**The boundary did not move**, and is still the point:

- **`adapters/tsconfig.json`** compiles `api` and the sources, IPTV and sync
  adapters with `lib: ["esnext"]` and `"types": []` — no `fetch`, no `URL`, no
  `console`, no timers. They reach the host only through the context they are
  handed.
- **`adapters/tsconfig.players.json`** is the players' own program, with React
  Native's types and the DOM's, because an engine has to draw.
- **This package's `tsconfig.json` excludes `adapters/`.** Compiled into the
  app's program they would inherit Expo's types, React Native's and the DOM's —
  exactly what they must not have. One repository makes that mistake *easier*
  to make by accident, so the exclusion is load-bearing.
- **Lint** keeps a concrete adapter out of everything but `src/composition/`.
- **`npm run typecheck`** runs all five programs; **vitest** runs two projects,
  named explicitly in `vitest.config.mjs` so npm workspaces are not
  auto-detected and this app's tests are not run under the wrong root.

### Native code

A player's engine is native code. expo-video, a published package, is
installed by this package and autolinked from `node_modules`. An Expo module in
a player's own folder — mpv's `android/` and `ios/` — is autolinked from the
workspace link, and is **the one native thing built from outside
`node_modules`**. Check it after touching a player:

```bash
npx expo-modules-autolinking resolve --platform android --json
npx expo-modules-autolinking resolve --platform apple --json
```

Nothing may report a `sourceDir` under `adapters/` but a player's own module.
`expo.autolinking.searchPaths` in `package.json` pins the app's
`node_modules` first, so its copies always win a tie.

Where two engines carry the same native library, the app decides which one
ships: `config-plugins/with-newest-libcxx.js` puts the newest
`libc++_shared.so` — libmpv's — in a source set of the app's own, which wins
the merge. That is the app's to settle, because no adapter can see what
another adapter's engine brought.

## Registering a plugin

`src/composition/plugins.ts` is the only file that names a plugin. Adding one is
an import and an entry in its list. Every plugin exports `plugin`: its
manifest, and the one role its category's block promises — `media`, `player`,
`account` or `backup` — once it is written.

The catalogue checks every manifest when the app starts, with
`validateManifest`: the category's one block, known platforms, the id's shape,
and every rule about fields and settings. A broken manifest stops a
development build and is left out of a production one. The catalogue hands
each role to the one service that calls it — `media` to the media service,
`player` to playback, `account` to the account service, `backup` to the backup
service — and nothing else ever holds it.

## Configured per connection

A source or IPTV plugin is in use once it has a connection, and adding one is
the whole of it: connections belong to the account, so there is nothing to
install on the device. A plugin can have several, and two Jellyfin servers are
normal. A connection's `enabled` switch turns it off for everyone; off, it has
nothing in effect.

Each connection decides what every profile keeps for itself, with **Separate
config per profile**:

| Mode | Each profile keeps | Typical use |
| --- | --- | --- |
| None | nothing: every profile uses the same values | one household account |
| Credentials | its own sign-in — the password fields and any field the manifest marks `credential` | an account per person on one server |
| All | its own value for every field and setting | different servers, or different libraries, per person |

The form only offers the modes the manifest can support. Under Credentials and
All, profile tabs sit right above the first field that differs per profile, and
each per-profile input shows the tab's avatar beside its label. Switching away
from None keeps the login with the profile doing the editing — the saved
password is moved, never shown — and every other profile signs in on its own
tab; saving warns before per-profile values would be discarded.

- **A profile that has not filled in its tab** sees "Finish setting up" on the
  tab the connection's content belongs to, linking straight to its own tab of
  the form.
- **"Don't use for {profile}"** switches the connection off for that profile:
  its details are dropped and it neither sees the connection nor is asked to
  finish it. "Use for {profile}" brings it back.
- **A PIN-protected profile's tab** stays locked behind its PIN for the rest of
  the form, and so does switching it off, so a child cannot replace or remove a
  parent's sign-in.

## Asking the server, only when told to

**Test connection** and **Load libraries** are buttons, never an automatic probe
while someone types: a server may lock an account after a few failed sign-ins.
Each tries the selected tab's values as they stand in the form, on a provider
outside the pool with its own installation id, so a probe never ends a running
session. Results name the server and its version, or say what went wrong in
words.

A `libraries` setting renders as *All*, *Only these* or *All except these*, with
the server's libraries listed once loaded. Libraries the server no longer
reports stay chosen, in case they come back.

## What a plugin is given

Sources, IPTV and sync plugins have no host globals — they compile against
`lib: ["esnext"]` alone — so everything reaches them through the
`PluginContext` built in `services/plugin-context.ts`:

| Port | What the app supplies |
| --- | --- |
| `http` | `platform/http-client.ts`: answers every status, fails only with a `TransportError` (`offline`, `unreachable`, `timeout`, `aborted`), times out reading the body too, and logs method, host, path, status and duration — never a query string, header or body |
| `credentials` | the password fields of this connection's scope, read from the credential store on demand |
| `session` | the scope's token, bound to the identity that signed in (see `docs/data`) |
| `network` | the network kind from `expo-network`; a browser only knows online or offline |
| `client` | app name and version, device name, and an installation id stable per device, connection and credential scope |
| `clock` | `now()`, and a `sleep()` that honours cancellation |
| `crypto` | `platform/plugin-crypto.ts`: HKDF, AES-GCM and randomness, native where the work is heavy |

The installation id hashes a device key with the connection and scope. The
device key is made once per install — from the vendor id on iOS or the Android
id, at random on the web — and kept in the secure store that never moves to
another phone, so a restored backup signs in as a new device rather than as
this one. A server that keeps one token per device then keeps one per profile
that signs in, instead of each sign-in ending the last one's session.

A player gets a `PlayerContext` instead: it resolves a stream's `headersRef` at
load time, and holds the headers in memory only (`docs/playback`).

## Where content appears

Each source or IPTV plugin says what its media role brings — `movies`,
`shows`, `anime`, `videos`, `files`, `live` — and the app places it by category
and kind:

| Tab | What appears there |
| --- | --- |
| Media | a source's movies, shows and anime — one library across every source |
| Videos | a source's videos and files — one tab per source |
| TV | everything an IPTV plugin brings, in Live, Movies and Series; and a source's `live` channels |

IPTV movies and series appear on TV only, never on Media. That mapping lives in
one place, `src/services/tab-content.ts`. Nothing in the app ever asks *which*
plugin a source is: it branches on the category and the effective capabilities
of a resolved source.

## Sync plugins: the account and backups

Sync plugins are device-wide, and do one of two jobs.

- **The account role** — `sync/custom-server`, "Your own server". Its fields
  are the server address, a username and a password. It declares an `account`
  block: `ownerProof`, the password typed again, and `signUp`, an invite code.
  The owner check, "Create an account" and signing out all come from those,
  with no plugin named in the app. `services/sync/` connects it with a session
  of its own, apart from any media connection, and signs in once for a try
  before anything is saved.
- **The backup role** — `sync/icloud`, `sync/google-drive`, `sync/onedrive`, in
  later phases. It declares a `backup` block and only stores bytes: `stat`,
  `read`, `write(name, bytes, ifMatch)` and `list`. The backup service builds
  and encrypts the file, and a write never overwrites one changed elsewhere.
- **`sync/mock`** is a pretend server account per endpoint, and
  **`sync/mock-backup`** a pretend backup target. Both live in memory, in
  development builds only.

A build without the account's plugin shows the account as unavailable, and can
still sign out of it.

## Plugins run on Hermes

On iOS and Android, plugin code runs on Hermes, which lacks a few built-ins
that Node and browsers have — `Array.prototype.toSorted`, `Object.groupBy`,
`crypto.randomUUID`. Code using them typechecks and passes every test, then
throws on a phone. App lint rejects them in `src/`, and the adapters' own
tests scan their sources for them.

## The rules, enforced

Lint fails if anything outside `src/composition/` imports a plugin, a
repository implementation or a platform module, and if anything outside
`src/platform/` imports `expo-local-authentication`. The plugin rule matches
every category's packages — `@sc/source-*`, `@sc/iptv-*`, `@sc/player-*` and
`@sc/sync-*` — and so `@sc/player-kit` too, once it exists (Phase 7). See the
`sc-verify` skill for how to prove the rules still bite.
