---
name: sc-add-plugin
description: Create a new Streaming Center plugin in its category folder — a source, an IPTV provider, a player, a sync plugin (your own server, or a backup target) or a metadata catalogue — with a manifest, its one block, capabilities and settings. Use when adding support for a new service or engine like Plex, a Stalker portal, mpv, OneDrive or TMDB.
---

# Adding a plugin

Read `docs/categories/`, `docs/writing-a-plugin/` and
`../.claude/streaming-center-architecture.md` section 7 first. This is the
working checklist.

## The test of success

One new folder under `adapters/<category>/`, and one line registering it in the
app. If you find yourself editing the app's screens, services or database
schema, the abstraction in `api` is wrong — fix that instead of working around
it.

## One job per plugin

First decide the category (`sc-plugin-categories` if in doubt):

| It… | Category | Block |
| --- | --- | --- |
| brings films, series, anime, videos or files | `sources` | `media` |
| brings live TV, and maybe a provider's films and series | `iptv` | `media`, with `live` |
| plays | `players` | `player` |
| keeps the account, or its backup | `sync` | `account` or `backup` |
| says what a film or series is, by its name | `metadata` | `metadata` |

A service with two jobs is **two plugins**: `sources/google-drive` and
`sync/google-drive`, each with its own sign-in. A **media server** (Jellyfin,
Emby, Plex) is a source and nothing else — it masters its users' watch status
through the media role.

## Checklist

1. **Create `adapters/<category>/<name>/`** with:
   - a `package.json`: `@sc/<source|iptv|player|sync|metadata>-<name>`,
     `"exports": "./src/index.ts"`, and `@sc/api` as a **peer** dependency, so
     the host supplies the one instance and branded IDs match. A player adds
     `@sc/player-kit`, `react`, `react-native` and its engine as peers.
   - `src/index.ts`
   - a `README.md` stating its category, what it brings or does, where it
     runs, and its status

2. **Write the manifest** and export it as `plugin`. Declare the category's
   **one** block, and where it really runs:

   ```ts
   import { pluginId, type Plugin } from '@sc/api';

   import { createProvider } from './provider';

   export const plugin: Plugin = {
     manifest: {
       id: pluginId('sources/<name>'),
       category: 'sources',
       platforms: ['ios', 'android', 'web'],
       displayName: '…',
       description: 'One sentence for the plugin list.',
       media: { contentKinds: ['movies', 'shows'], capabilities: ['browse'] },
       connectionFields: [
         { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
         { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
         { key: 'password', label: 'Password', type: 'password' },
       ],
       settings: [],
     },
     // Only once the role is implemented; until then, leave it out and declare no capability.
     media: { connect: async (target, context) => createProvider(target, context) },
   };
   ```

   - **A player** declares `player: { profiles: { ios: {…}, android: {…} } }`
     and exports `player: { create }` plus a `PlayerView`.
   - **An account** declares `account: { ownerProof?, signUp? }` and exports
     `account: { connect }`.
   - **A backup target** declares `backup: { location }` and exports
     `backup: { connect }`.
   - **A metadata catalogue** declares `metadata: { identifies }` and exports
     `metadata: { connect }`; where its terms ask the app to credit it, the
     manifest's `attribution` says how, and Settings → About shows it.

   The provider reaches the host only through `context`: `http` for requests,
   `session` for a token, `credentials` for passwords, and `network`,
   `client`, `clock` and `crypto`. `api/` and every non-player plugin have no
   host globals: the compiler refuses `fetch`, `URL`, `console` and timers.

3. **Declare capabilities honestly.** They are not documentation — application
   code branches on them.
   - Listing `search` while `search()` throws turns every query into a
     `sourceError`; leaving it out means the method is never called.
   - Declare a capability in the same change that implements it.
   - The conformance test fails a declared capability whose members
     (`MEDIA_CAPABILITY_MEMBERS`) are missing, and a block without its role.

   Also, for a source or IPTV plugin:
   - Order `listItems` pages exactly by `compareItems(query.sort)`.
   - Sign in once for concurrent callers.
   - Never retry a refused login.
   - Keep playback addresses in memory only.

4. **Say where it runs.** `platforms` is honest.
   - A plugin that needs iCloud's container is `['ios']`.
   - A portal without CORS headers, or one that needs a `Cookie` header, is not
     `web`.
   - A player's profiles name only platforms in `platforms`.

5. **Map at the boundary.** Remote payloads become domain types *inside* this
   package. No external type may appear in a return value. Adapter-only data
   goes in provider-scoped metadata nothing else reads.

6. **Route secrets through the injected credential store.** A secret is a
   `password` connection field; the app stores it behind an opaque
   `credentialsRef`. Anything that signs in on its own is a password field,
   whatever it looks like — a portal's MAC address or device id, a playlist
   address with the sign-in in it.
   - `settings` is a plain database column and cannot hold a `password` field
     at all.
   - Artwork or a stream needing auth carries a `headersRef`, never an inline
     header.

7. **Normalize errors** to `AppError` with a known code and a retry hint
   (`backoff`, `network-change`, `never`). A raw HTTP or transport error reaching
   the UI is a bug.

8. **Add it to `test/manifests.test.ts`**, the conformance check, and test the
   role against `fakeHttp` / `fakeContext` from `test/support/` with recorded
   payloads in `test/fixtures/`.

9. **Register it** in the app's composition root —
   `streaming_center_app/src/composition/plugins.ts`, one line — and add the
   `file:` dependency by its folder path.

## If it is your own server's account role

```ts
import type { AccountRole } from '@sc/api';

export const account: AccountRole = {
  connect: async (target, context) => ({
    connectionId: target.connectionId,
    info: async () => ({ serverVersion: '…', maxProfiles: 10, signUp: 'invite' }), // no sign-in
    status: async () => ({ accountId: '…', accountName: '…' }),                    // sign in, once
    pull: async () => ({ records: [] }),                                           // every record
    push: async (records) => ({ kind: 'stored' }),                                 // all or nothing
    dispose: async () => {},
  }),
};
```

- **`pull` is complete.** Every record of the account, deleted ones included.
  A record left out reads as lost.
- **`push` is all or nothing.** Store the batch in one transaction, or none of
  it, and name the write that stopped it: `limit`, `deleted` or `invalid`.
- **Deletes are soft**, and a deleted profile or connection stays deleted.
- **Passwords travel in `secrets`**, in plain text, to your own server. A name
  listed without a value keeps the stored one.
- **Never resolve conflicts.** The app does.
- **A session that ends gets one sign-in** with the saved password. A refusal
  is latched until the user acts; a throttled one is `backoff` with
  `too-many-attempts`.
- **`verifyOwner(proof)`** checks the `ownerProof` fields, typed again —
  never the saved ones. **`createAccount(fields, { firstProfile })`** takes
  the `signUp` fields, tried once.

## If it is a backup target

`stat`, `read`, `list`, and `write(name, bytes, ifMatch)`, which refuses with
`SYNC_CONFLICT` when the file changed since that etag. Bytes only: the file's
format and encryption are the app's.

## If it is a metadata catalogue

`check`, and `identify({ type, title, originalTitle?, year? })`, answering
with the catalogue's ids or nothing.

- **Nothing rather than a guess.** The app keys watch status by what you
  answer, so a wrong id merges two films' history. Take a name in another
  language only once the film's own translations or alternative titles hold
  it, and refuse a name several films share when no year tells them apart.
- **A year either side.** A portal writes the year it saw, and a film comes
  out a year apart in two countries.
- **The key is a password field**, read once, and latched when refused. A
  catalogue that counts requests gets `backoff`; the app pauses.
- **The workspace:** `adapters/metadata/*` in the app's `workspaces`, and
  `metadata/*/src/**/*.ts` in `adapters/tsconfig.json`.

## If it is a player

- **A `MediaPlayer`:** framework-free, reporting `PlayerEvent`s — a state
  once, what was asked for rather than an engine's lagging flag, nothing
  before a load, every failure a `failed` state and an `AppError`.
  `createPlayerEvents` in `@sc/api` keeps the listeners' promise;
  `playbackFailed` and `playerReleased` are the errors.
- **A `PlayerView`**, from `@sc/player-kit`, that draws it. It finds its
  engine behind the controller (a `WeakMap` in the package).
- **A profile per platform** that states only what the engine really plays.
- **Its engine and React as peers,** installed by the app; here as
  development dependencies, for the players' TypeScript program
  (`tsconfig.players.json`) and the tests.
- **Platform files** — `engine.ts` / `engine.web.ts`, `view.tsx` /
  `view.web.tsx` — exporting the same names.
- **Tests against a fake engine:** alias a native one in `vitest.config.ts`,
  hand a web one its host. `players/system` shows both.
- **Native code,** if any: an Expo module in the package's own folder —
  `expo-module.config.json` beside `package.json`, naming its platforms, and
  `android/` built with `expo-module-gradle-plugin`: the player a shared
  object, its picture an `ExpoView`. `players/mpv` shows it.
  - Reach it through `expo` (a peer), lazily: `requireNativeModule` when the
    first controller is made, never at import. The package is imported on
    every platform, and the module exists only where it was built.
  - Hand the native view the player's `__expo_shared_object_id__`, never the
    object: React Native's development renderer deep-freezes every prop a
    native view mounts with, and a frozen shared object cannot be released.
  - Keep every call to the engine on one thread of the package's own — never
    the app's main thread, where a call that waits for a busy engine is an
    ANR — and stream addresses in memory only.
  - **An engine that logs the address it opens is a leak**, since a stream
    URL carries a Jellyfin `api_key` or a portal's session token. libmpv is
    quietened with `--quiet`; libmpv's published Android wrapper cannot be,
    so `players/mpv` talks to its C API itself.
  - `platforms` says where the module is built — no more.
  - In the app, check autolinking takes nothing from this repository's
    `node_modules` (the app's `docs/plugins`).

## Boundaries lint will not catch yet

- A non-player plugin may import `@sc/api` and nothing else from this project,
  and no framework — not React, not Expo.
- A player may add `@sc/player-kit`, React, React Native and its engine, and
  nothing from another plugin.
- **Plugins never import each other.** If two need the same client, that
  client becomes its own package.

## Verify

```bash
npm install
npm run typecheck
npm test
```

## Current state

**`api` holds the target vocabulary:**

- categories, platforms and qualified ids
- the media contract, with live TV and playback members
- the player contract, `choosePlayer` and `createPlayerEvents`
- the account role (`AccountRecord`, `isAccountRecord`, with fixtures shared
  with the server)
- the backup role

**Read these before writing another:**

- `sources/jellyfin` — the reference implementation of a media role
- `sources/mock` — a partial one, on purpose
- `sync/custom-server` — the reference account role: PocketBase's
  sign-in and sessions, records read and written, sign-up and the owner check
- `sync/mock-backup` — a backup target at its smallest: bytes and
  etags
- `players/system` — the reference player: expo-video on phones, the
  browser's `<video>` and a lazily loaded hls.js on the web, a profile per
  platform
- `players/mpv` — the reference native player: libmpv behind an Expo
  module of its own, on Android
- `players/mpv` — the same, one step further: its own JNI on the
  engine's C API, every call on a thread of its own, and a watchdog that says
  so when a decoder takes a stream and hands back no frame
- `iptv/mock` — live TV at its simplest: groups, channels, a guide
  worked out from the time
