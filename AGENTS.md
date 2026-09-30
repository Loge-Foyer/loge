# AGENTS.md — streaming_center_app

The Streaming Center client: an Expo/React Native app targeting **iOS, Android
and web**. Read the workspace root `AGENTS.md` and
`../.claude/streaming-center-architecture.md` first.

This repository owns **the experience**: screens, services, the local
database, the backup file's format, platform access and composition. It does
not own domain types or any plugin — those live in `streaming_center_plugins`.

**This file describes the target.** Phase 5 wrote the new architecture down,
and Phase 6 moved the code to it; what is still to come — playback above all —
says which phase brings it. "Current state", at the end, says what runs today.

---

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely
renamed, moved, or removed. Before writing any code that touches an Expo, EAS,
or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all
   Expo docs with corrections to common LLM misconceptions. Follow its links to
   the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file
  there is a screen, `_layout.tsx` files define navigators. Keep non-route code
  (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`,
`eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or
Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects,
or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in
docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Expo rules

- If `ios/` and `android/` directories do not exist, they are generated
  (Continuous Native Generation). Never create or edit them by hand — configure
  native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with
  native code, the app needs a development build: `npx expo run:ios|android`
  locally, or `eas build --profile development`.
- **This app is past that point.** Phones run a development build:
  `npm run android` / `npm run ios` build and install it, then Metro serves the
  JavaScript as before.
  - Player engines are native code: expo-video for the built-in player
    (Phase 7), Expo modules for KSPlayer, mpv and VLC (Phase 8).
  - Face ID needs the app's usage text, which Expo Go cannot carry.

  A native change means building again — a stale build looks like code that
  did not change. The web needs no build.
- Prefer recommended Expo modules over third-party libraries, and check your
  available skills before adding dependencies.
  Docs: https://docs.expo.dev/versions/latest/index.md

---

## Project invariants

These are specific to Streaming Center and matter more than anything above.

1. **Never define a domain type here.** `MediaItem`, `GlobalMediaKey`, the
   capability types and every plugin contract live in `@sc/api`, and the React
   half of the player contract in `@sc/player-kit` — both in the plugins
   repository. Defining them here makes the dependency graph circular.

2. **No plugin names above the composition root.** There must never be an
   `if (providerId === 'jellyfin')` in a screen, component or service. Branch on
   the plugin's **category** and its **effective** capabilities — what it
   declares, intersected with the toggles switched on for that connection, on
   the values the active profile runs it with (`effectiveCapabilities`, through
   `services/sources.ts`). A connection switched off (`enabled: false`) has
   nothing in effect. Branching on declared alone calls features the user
   switched off. Where content appears is category plus kind, decided in
   `services/tab-content.ts` and nowhere else.

3. **Only the composition root imports a concrete plugin** — a source, IPTV,
   player or sync package, and so a player's view. Screens resolve what they
   need from injected services. `@sc/player-kit` holds only types — the React
   half of the player contract — and may be named anywhere as `import type`;
   lint refuses anything more. This is what keeps the boundary real rather
   than aspirational.

4. **Secrets never reach the database** — SQLite on native, IndexedDB on web.
   The database stores opaque refs; values live behind `SecureCredentialStore`
   (keychain on native, encrypted IndexedDB on web). Secrets are manifest
   `password` fields — anything that signs in on its own is one, a portal's
   MAC address included — PINs, session tokens and the backup key; none of
   them enters a row, a journal entry, a query key, a provider fingerprint or
   a log.
   A changed secret gets a new ref — never overwrite one in place. Session
   tokens, the device key and the backup key go in the *device-bound* store,
   never restored onto another phone.
   - Account-wide passwords do travel — in plain text to your own server, and
     inside the encrypted backup file — but on a device they go from the wire or
     the file straight into the keychain.
   - A stream URL can carry credentials, so a playback descriptor lives in
     memory only: never persisted, never logged.

5. **Writes are local-first.** A user action writes to the local database and
   appends a change-journal entry in one transaction, then returns. The sync
   engine, or the next backup, takes it later. No network call in a UI
   interaction path — favouriting must work in airplane mode. Local queries and
   mutations run with `networkMode: 'always'`: a browser saying "offline" must
   not pause them. State a source masters, like watch status on Jellyfin, is
   cached locally and written through an outbox (`services/watch/`).

6. **Profile separation is enforced twice.** Every user-owned table carries
   `user_id` with a cascade from `users`, *and* every query cache key is
   prefixed with the active user (`userKey()` / `deviceKey()` in
   `src/services/query-keys.ts`). The database alone is not enough. What a
   source answered is keyed with `remoteKey()`, so a local change never
   refetches every server. What lives where:
   - **Account-wide** — profiles, their PINs and preferences, and source and
     IPTV connections with each profile's values on them. Journaled, carried to
     your server, written into backups. What a profile keeps for itself on a
     connection — its values under the connection's `perProfile` mode — is
     user-owned and goes with the profile.
   - **Device-wide** — players (on or off, the default, their settings), sync
     plugins (your server's sign-in, a backup target and its key), the default
     profile, sessions, the device key, caches, the journal and sync state.
     Never journaled, never pushed, never in a backup.

7. **Components take domain types.** `<PosterCard item={item} />`, never
   `<JellyfinPoster raw={payload} />`. Artwork goes through
   `components/artwork.tsx`, which resolves a reference through the media
   service — never a raw URI, because a reference may need an auth header that
   must not sit where a component can read it.

8. **Never try a failed sign-in again on your own.** Servers lock accounts
   after a few failures — Jellyfin, your own server and an IPTV portal alike. A
   source that answers `UNAUTHORIZED` is parked until the user acts, a plugin
   signs in once per 401 at most, and Test connection / Load libraries are
   buttons — never a probe while someone is typing.

---

## Persistence

`src/persistence/` holds both engines behind `LocalDatabase` (`services/ports.ts`).
`docs/data` explains each rule; these are the ones that break silently.

- **A transaction awaits nothing but its `tx` repositories.** IndexedDB commits
  a transaction the moment it waits on anything else — a keychain call,
  WebCrypto, a fetch — and SQLite deadlocks on a call to the database that
  skips `tx`. A write that also touches secrets is plan (read, write fresh
  secrets) → one transaction (rows, queued stale refs) → clean up
  (`janitor.drain()`). Fresh secrets are deleted again if the transaction fails.
- **Never expo-sqlite's transaction helpers.** `withTransactionAsync` lets
  other statements into the transaction; `withExclusiveTransactionAsync` runs on
  a second connection with foreign keys, and so every cascade, off. Lint rejects
  both. `persistence/sqlite/sql.ts` serializes one connection instead.
- **Never `INSERT OR REPLACE` a parent row.** It deletes first, and the cascade
  takes the children. Update in place.
- **Migrations are numbered, committed, never edited, never destructive.** A
  newer database is refused. A table rebuild is a `foreignKeysOff` step. The
  latest three: v3 qualifies stored plugin ids by category and v4 brings the
  account model (both Phase 6); v5 adds watch status and its outbox (Phase 7).
  `docs/data` has what each does.
- **Journaling is the repositories' job,** in the same transaction. A write that
  changes nothing writes nothing. Only account-wide state is journaled: device
  settings, sync-category connections, the account's own rows (`account`,
  `account_sync`, `backup_state`), the media cache and cascaded rows are not.
  The journal's `user_id` does not cascade. A PIN is journaled apart from its
  profile's name (`userPin`).
- **What arrives from the account is written unjournaled** —
  `SyncDatabase.unjournaled`, which only the sync engine and the account service
  receive. Journaled, a pulled change would be sent straight back. Never use it
  for a change the user made.
- **Secrets are deleted through the queue.** A ref the rows stop pointing at is
  added to `staleSecrets` in the same transaction; `SecretJanitor` deletes it
  after the commit and at launch. The keychain cannot list its keys, so a missed
  delete lasts for ever.
- **A missing secret is never a sign-in.** When a row lists a saved password the
  store no longer has — after a restore — the pool refuses with
  `MissingSecretError` instead of signing in with nothing.
- **The device key is never in the database,** which phone backups copy to
  other phones. It lives in the device-bound secure store. A fingerprint of it
  in the database — never the key — spots a phone restored from its OS backup
  at boot: the pending journal and the session are dropped, so a stale journal
  is never pushed.
- **The backup database is not the device database.** A `.scbackup` has its
  own versioned schema, is built and read in memory — expo-sqlite's
  `serializeAsync` / `deserializeDatabaseAsync` on native, sql.js on the web —
  and is never opened as a database the app runs on. Never copy the device
  database into a backup, or restore one by replacing the device database's
  file.
- **sql.js is only for backups on the web,** loaded through `import()` from a
  web-only file when a backup is written or opened, so no native bundle carries
  it. The web's own data stays in IndexedDB; never move it to SQLite compiled
  to WebAssembly.
- **The media cache is a cache.** Never journaled, never synced, never in a
  backup; every read and write best effort; kept only where `offlineMetadata`
  is effective for that profile, and served only under the fingerprint it was
  saved with. A connection change purges it in the same transaction. Screens
  show it as `placeholderData`, never through `setQueryData`.
- **Tests run on the real engines** — `node:sqlite` and fake-indexeddb, one
  contract suite for both, and sql.js for backups. Never mock a repository.

---

## The account

A device holds exactly one account once it is set up: **local**, or **on your
own server** (PocketBase, `../streaming_center_sync`). It holds up to ten
profiles — fixed at ten locally, `info().maxProfiles` on a server
(`SC_MAX_PROFILES`, default 10). The `account` row says which it is;
`services/account.ts` changes it, and `services/sync/` keeps a server account
in step. `docs/architecture` and `docs/data` explain each rule. These break
silently:

- **Only `AccountService` changes the account** — creating one, signing in,
  signing up, signing out, importing a backup. Your server's sign-in is a
  sync-category connection that belongs to the device: no connection form
  edits it, and it is never journaled, pushed or backed up.
- **Changing account replaces; accounts are never merged.**
  - Signing in to an existing server account: try once, read it whole, then —
    after a confirmation that offers to export a backup first, and the owner
    check — replace this device's account in one transaction.
  - Signing up from a local account uploads it: refuse up front when it holds
    more profiles than the server's `maxProfiles`, then
    `createAccount(fields, { firstProfile: false })`, then announce every local
    row for the first push. A fresh device signs up with `firstProfile: true`.
  - Never build a merge or a "join". Phase 4 had one; it is retired.
- **Signing out keeps a local copy,** which becomes a local account. Importing
  a backup always yields a local account; on a device signed in to your server,
  it signs out first, after asking.
- **A run pushes, then reads, then reconciles.** The journal after the
  checkpoint goes as one all-or-nothing batch, parents first; then every record
  of the account is read; then one unjournaled transaction reconciles. There
  are no cursors and no log: the server's collections are the truth.
- **Reconcile by these rules and no other** — never by a clock:
  1. an entity with a pending local change is skipped: this device's change
     goes next
  2. a deleted profile or connection is deleted here, always
  3. otherwise the server's version replaces the local one when they differ
  4. a local row the server lacks, and that is not pending, was lost by a
     restore: announce it again, and the next push puts it back
- **A refused batch names the write that stopped it,** and the rest is sent
  again. A profile over the limit stays on this device only, with everything
  of it, and says so; a write to a deleted profile or connection gives way to
  the delete, with its children; one the server finds invalid is left out and
  logged — and not taken for lost, and sent again, on every run. The
  checkpoint moves past what was stored, and no further.
- **A reconcile or replace transaction awaits nothing but `tx`** — not the
  credential store, not a plugin, not `profiles.remove` (use the helpers in
  `services/removal.ts`). PINs and passwords are written to the keychain under
  fresh refs before it; refs it does not adopt are queued inside it, never
  before they exist; the janitor runs after.
- **Nothing in an apply may fail on the data.** Check, then insert or update:
  on IndexedDB a failed request aborts the whole transaction even when caught,
  and the page would never move on. A record `isAccountRecord` refuses, or
  whose parent is gone, is skipped and logged — never its payload.
- **A refused sign-in is never retried by itself** — not on a network change,
  not on a poll, not on "Sync now". The engine parks until the user signs in
  again. When a session ends — 30 days offline, or the password changed
  elsewhere — the plugin signs in once with the saved password; a refusal is
  latched.
- **Sign in once.** The try's session becomes the account's, handed over inside
  the run lock. A second sign-in at the server for one "Sign in" means the
  handover broke.
- **Signing in again changes only the password.** The address and username
  are the account's, read-only: a different one is another account, and
  reaching it is Switch, which replaces.
- **A created account is never created again.** After `createAccount`, a
  failure is `AccountCreatedError`, and the form turns to signing in.
- **The sign-in flow uses no profile's hook.** Welcome shares it, outside
  `(app)`, before any profile exists. And it never navigates after replacing
  the account or importing a backup: that may have taken the profile in use,
  and `(app)` with it — the gate moves instead (`session.refresh()`).
- **The profile limit is the profiles service's.** "Add a profile" is hidden
  at the limit and says why. A local copy kept on signing out that holds more
  than ten keeps them all, and takes no new one until there are fewer.
- **Only `src/platform/` imports `expo-local-authentication`.** Screens ask
  `OwnerCheck` (`useOwnerMethod`, `pins.forgot`); lint enforces it, and the web
  build gets a stub that answers "unavailable".
- **The owner's proof is typed, never saved.** On a server account its
  `ownerProof` fields — the account password — are asked for again in
  `OwnerProofForm` and passed to `owner.verify(reason, proof)`; the saved
  password is never the proof. An empty proof is refused before anything is
  asked. On a local account, or when your server no longer takes this
  device's saved password, the device answers — never a quiet yes. A server
  that cannot be reached is a failure, never a fallback to the device.
- **The owner check guards** Forgot PIN, signing out, replacing or switching
  the account, importing a backup, and showing the backup key — on a device
  that holds profiles. At first launch there is nothing to protect, and
  nothing is asked.
- **Retired:** Phase 4's log and its cursors, joining an account, sealed
  passwords, the vault key and the sign-in rule, the derived owner proof and
  `modules/key-derivation`. Never bring them back; git has them.

---

## Backups

`services/backup/` writes and reads the account as one encrypted `.scbackup`
file, and `services/backup/targets.ts` keeps it on backup targets. `docs/data`
has the format. These break silently:

- **It holds every password and PIN of the account,** so it is encrypted as a
  whole, and its key lives in the device-bound store, shown only after the
  owner check. Never write a backup, or any part of one, unencrypted — not to
  the cache directory, not to a log.
- **It never holds** caches, device settings, players, sync settings, tokens,
  the device key, the journal or sync state.
- **One mapper** turns the account into the server's records, the sign-up
  upload and the backup's rows. A new account-wide field is added there, once;
  anywhere else, a sync or a backup round trip drops it.
- **Import checks everything before it replaces anything** — size (64 MiB at
  most), key id, decryption, `quick_check`, schema version, every row — then
  writes secrets under fresh refs, the rows in one transaction, and runs the
  janitor. A newer schema is refused, never guessed at.
- **A lost key is an unreadable backup.** Say so plainly; never offer a way
  around it.
- **A backup target never overwrites a file changed elsewhere.** Writes are
  conditional on the etag; `backup_state` remembers `{ lineage, generation,
  etag }` per target, and a file this device has not seen, or one changed
  since, asks — open theirs, keep this device's, or keep both (a new lineage
  for this device's account). A target only stores bytes, and is not live
  sync. An account on your server saves over its file: its devices hold the
  same account.
- **One file per account on a target,** named from its lineage. Never name it
  after the account's name or a device: two accounts must never share a file.
- **The import flow and Welcome's Restore use no profile's hook,** and never
  navigate after importing: the gate moves (`session.refresh()`).

---

## Players

The built-in player plays — expo-video on phones, the browser's `<video>`
with hls.js on the web — from the player screen. `docs/playback` has the
design; these are the rules:

- **Players are device-wide plugins.** Which are on, the default and their
  settings are device settings — never journaled, never on the server, never
  in a backup.
- **Only the composition root imports a player package or `@sc/player-kit`.**
  Screens get the chosen player's controller and view from it through
  `useServices()`. The app never imports an engine — expo-video, hls.js, an
  Expo module — itself: that is the player plugin's (lint). It installs them,
  as the player's peers, so that autolinking builds them and Metro bundles one
  copy of each.
- **Choosing is `choosePlayer` from `@sc/api`, and pure:** the device's
  default if it can play one of the item's sources, else the first enabled
  player on this platform that can, else none — and the app says what would
  ("This channel needs a player that plays MPEG-TS."). Never by an engine's
  name.
- **A descriptor lives in memory only.** Never persisted, never in the media
  cache, never logged; redaction covers URLs and MAC addresses. `headersRef` is
  resolved by the engine at load time, never inlined.
- **Progress goes through the outbox,** never straight from the player to the
  source: the `watch_status` cache and an outbox entry in one transaction (v5),
  through `WatchService` — which tells a source without `watchStateWrite`
  nothing. The drainer carries it; never call `reportPlayback` or `setPlayed`
  from anywhere else.
- **Until the source has heard, this device's watch state is shown** — laid
  over what the source answered, wherever the outbox still holds something
  for the item. After that the source wins. Never keep an item's watch state
  anywhere else, and never master it a second time.
- **The null engine fails loudly.** A silent no-op turns "playback not
  implemented" into a mystery bug.
- **A controller is made inside an effect, never kept across one**, and a
  descriptor lives in that screen's state, never in the query cache
  (`hooks/use-playback.ts`). Fast Refresh and strict mode run effects twice:
  a controller disposed in one run and reused in the next hands the native
  view a released player.
- **Every screen but the player's is upright.** `app.json` allows every
  orientation, the app locks upright at launch through
  `ScreenOrientationControl` (`platform/screen-orientation.ts`), and the
  player screen frees it while open. Never set `orientation` back to
  `portrait`: the player could not turn.

---

## Web is a first-class target

Not an afterthought. Things to know:

- **Storage on web is IndexedDB, not SQLite.** No SQLite-wasm for the data, no
  COOP/COEP headers. Not localStorage either: a local-first write needs the
  data and its journal entry in one transaction. The only WebAssembly is
  sql.js, loaded to write or open a backup file.
- **The page must be secure** — `https` or `localhost` — because the secrets are
  encrypted with WebCrypto. On plain `http` from a network address the app
  refuses to start (`composition/storage.web.ts`). That is about the page only:
  never require TLS of a source.
- **The Content-Security-Policy allows `'wasm-unsafe-eval'`, for sql.js, and
  nothing more.** Any script on the page can use the secrets' key, so the CSP
  is part of their protection.
- **IPTV is hidden on the web** until a proxy exists: portals send no CORS
  headers, and a browser forbids a `Cookie` header. Their manifests leave `web`
  out of `platforms`; never work around that in the app.
- `web.output` is `"single"` — an SPA. Nothing is pre-rendered; do not add
  `+html.tsx` or server-only assumptions.
- `src/app/_layout.tsx` imports `@tamagui/core/reset.css`; without it browser
  defaults (button padding) break components.
- Tabs on web are `src/components/app-tabs.web.tsx`, a top navigation bar.
- A browser's `fetch` must be called unbound (`const { fetch } = deps`), and a
  page on `https` cannot reach an `http` server on the local network.

---

## iOS and Android run Hermes

Hermes lacks built-ins that Node and browsers have — `Array.prototype.toSorted`,
`Object.groupBy`, `crypto.randomUUID`, `Uint8Array.prototype.toBase64`, and
possibly `structuredClone`, `Promise.withResolvers` and
`Intl.RelativeTimeFormat`. Code using them typechecks, passes vitest (Node) and
works on the web, then throws on a phone: Continue Watching broke exactly like
that. Lint rejects them in `src/`; copy and sort (`[...list].sort(compare)`)
instead, and turn bytes into text with `@sc/api`'s helpers. Plugins run on
Hermes too — the plugins repository's tests scan for the same gaps. The app's
TypeScript program never sees Node's types; only `test/tsconfig.json` does.

Hermes also has no JIT: cryptography written in JavaScript runs about a hundred
times slower than on a browser's engine. Measured on the emulator, scrypt at a
useful strength took 22 s. So anything heavy is native — AES-GCM through
expo-crypto, over a whole backup file too — and only cheap work (HKDF: a few
HMACs, one SHA-256 per record id) is left to JavaScript. That is why key
derivation was a native module in Phase 4, and why no password-based key
derivation is built again in JavaScript.

## Cryptography

- **Only `src/platform/` does cryptography.** noble is imported there alone
  (lint). Plugins reach it through their context (`PluginContext.crypto`);
  services — the backup file's included — through what the composition root
  hands them.
- **One definition for every platform:** `platform/plugin-crypto.ts` builds
  the port from expo-crypto's AES-GCM and randomness — WebCrypto behind it in
  a browser — and noble's SHA-256 and HKDF.
- **expo-crypto reads a string of additional data as base64**, and turns bytes
  into base64 through `btoa`. Additional data — a backup's header — goes in as
  base64 that `@sc/api` encoded: never raw text, never bytes.

---

## Consuming plugins

The plugins are a separate repository, so npm workspaces cannot span them. They
are linked with `file:` dependencies — `@sc/api`, `@sc/player-kit`, and one
package per plugin, at its category path — and Metro watches the folder:

```jsonc
// package.json — one line per plugin; the names follow the folders
"@sc/api": "file:../streaming_center_plugins/api",
"@sc/player-kit": "file:../streaming_center_plugins/player-kit",
"@sc/source-jellyfin": "file:../streaming_center_plugins/plugins/sources/jellyfin",
"@sc/iptv-stalker": "file:../streaming_center_plugins/plugins/iptv/stalker",
"@sc/player-system": "file:../streaming_center_plugins/plugins/players/system",
"@sc/sync-custom-server": "file:../streaming_center_plugins/plugins/sync/custom-server"
```

```js
// metro.config.js, in short
config.watchFolders = [...config.watchFolders, plugins];
// A plugin file's bare imports resolve from the app, as a published package's would.
config.resolver.resolveRequest = (context, name, platform) =>
  isBare(name) && context.originModulePath.startsWith(plugins + path.sep)
    ? context.resolveRequest({ ...context, originModulePath: appOrigin }, name, platform)
    : context.resolveRequest(context, name, platform);
// …and the plugins repository's own node_modules are blocked outright.
config.resolver.blockList = [...blockList, /^<plugins>\/node_modules\/.*/];
```

- **One copy of everything a plugin imports.** The plugins repository installs
  React, React Native, expo and expo-video for its own typecheck and tests.
  Resolved from there, a second React breaks every hook and a second
  expo-video its native views. So:
  - **Metro** resolves a plugin file's bare imports from the app, and blocks
    the plugins repository's `node_modules`: a request that slips past fails
    the build instead of bundling a second copy.
  - **TypeScript** has `preserveSymlinks`: a plugin is seen where it is
    linked, in this app's `node_modules`, so its imports find this app's
    types. Never map `react` in `paths` — Expo's Metro applies tsconfig paths
    too, and React's types are not a module it can bundle.
  - **vitest** dedupes React, React Native, expo-video and hls.js, and stubs
    expo-video (`test/support/expo-video.ts`): the shipped list includes the
    built-in player, and Node has no native module.
- Install the plugins repository first: its own tests and typecheck need it.
- Plugins take `@sc/api` — and players `@sc/player-kit`, React, React Native
  and their engine — as **peers**: the app supplies the one copy.
- `npm ls --all` shows `UNMET DEPENDENCY @sc/api@*` under each linked plugin,
  and `expo-doctor` reports "multiple copies" of React, React Native and
  expo-video. Both see the plugins repository's own copies, which the app
  never uses; npm resolves a link's peers from the link's folder.
- No `resolver.nodeModulesPaths` is needed: babel-preset-expo imports its
  runtime helpers by absolute path (verified in dev and production bundles).
- Register a plugin in `src/composition/plugins.ts` — the only file that may
  import one; lint enforces it. Every plugin exports `plugin`: its manifest,
  and the one role its category's block promises.
- **A player's native code.** expo-video is a published package: the app
  installs it and autolinking builds it from the app's `node_modules` —
  proven in Phase 7 on Android, where the built-in player's view drew HLS,
  live HLS, MPEG-TS and MP4 from the linked package. An Expo module in a
  player's own folder (Phase 8) reaches the build some other way, and Phase 8
  opens with that spike. A new or changed player means building again.

**This is the main technical risk in the repository split.** Verify with a
real export, not a typecheck.

---

## UI

- **Tamagui 2.7.7** (`v5` preset) is the one component system. Pin every
  `@tamagui/*` package to the same exact version.
- **One theme entry point:** `src/tamagui.config.ts`. Never add a second theme
  or styling system beside it. `@expo/ui` is installed because expo-router
  depends on it — do not use it for screens.
- v5 is **shorthands-only** (`bg`, `p`, `rounded`, `items`…); media keys are
  min-width (`$sm`, `$md`, `$lg`, `$xl`).
- Native-drawn chrome (NativeTabs, stack headers, native switches) takes
  resolved colours: `String(theme.x.val)`.
- Scrolling surfaces are React Native `ScrollView`/`FlatList`, not Tamagui's;
  the full-screen grid is `@shopify/flash-list`, keyed by its column count.
- v5 views default to `position: static` on the web. An overlay's container
  (badges on a poster, text over a hero) needs `position="relative"`, or the
  overlay lands on some ancestor — right on a phone, wrong in a browser.
- React Native components take `pointerEvents` in `style`; the prop is
  deprecated.
- Screen kinds come from `src/components/stack-options.tsx`: tab root,
  full-screen page, detail (transparent header), sheet.
- **Four tabs:** Media, Videos, TV, Settings. Settings → Plugins is four rows —
  Sources, IPTV, Players, Sync — each opening that category's list for this
  platform (`settings/plugins/[category]`, then `[category]/[name]`: the id's
  two parts are the two segments, so no id is ever URL-encoded). There is no
  global list.
- Forms render from manifests (`src/components/manifest-form/`), switching on
  `field.type` only. Never write a form for a specific plugin.

---

## Skills

`.agents/skills/` in this repository:

- **`sc-verify`** — the full verification pass. Use before committing.
- **`sc-run`** — launch on simulator, emulator or browser.
- **`sc-use-plugin`** — wiring a plugin from the plugins repository.

Plus 13 official skills from [`expo/skills`](https://github.com/expo/skills) —
`expo-router`, `expo-ui`, `expo-native-ui`, `expo-design-system`,
`expo-animation`, `expo-data-fetching`, `expo-module`, `expo-dev-client`,
`expo-project-structure`, `expo-upgrade`, `expo-examples`, `expo-overview`,
`eas-hosting`.

Install more with:

```bash
npx skills add expo/skills --skill <name> --agent universal --copy
```

`--agent universal` targets `.agents/skills/`; `--copy` writes real files rather
than symlinks so they commit with the repository. `npx skills update` refreshes
them.

Prefer a skill over answering from memory — the Expo ones exist precisely
because training data goes stale between SDK releases.

---

## Current state

**Phase 6 — the code is on the new architecture.** Everything above describes
the target; what runs today:

- **Four tabs** — Media, Videos, TV, Settings — with TV showing the way to add
  an IPTV source. Settings → Plugins is four lists, by category, of the
  plugins that run on this platform. Stored plugin ids are qualified by
  category (database v3).
- **One account per device,** local or on your own server (database v4).
  Welcome creates one on the device, or signs in to your server. Signing in
  replaces the device's account; signing up with an invite uploads it; signing
  out keeps a local copy. A run pushes the journal as batches, reads the whole
  account and reconciles by the four rules; a profile over the server's limit
  stays on this device only. Your own server is PocketBase
  (`../streaming_center_sync`), and its password, typed again, is the owner
  check. The dev-only mock is a pretend server in memory. Ten profiles at
  most, or the server's limit.
- **Media is real:** Continue Watching, one row per kind with per-profile
  order, sort and card style, a full-screen grid per row, and detail pages —
  from every live source, merged, and kept per profile where the source allows
  it. Jellyfin and the mock implement the media role. Videos still shows
  skeletons.
- **The backup file:** Settings → Plugins → Sync exports it — the share sheet
  on a phone, a download in a browser — imports it, and shows its key behind
  the owner check; Welcome restores one. Backup targets keep it saved, asking
  before they overwrite a file another device changed; the dev-only mock
  target is the only one with a role so far. sql.js is its own lazily loaded
  chunk on the web.
- **Playing:** Play, Resume and Mark watched on detail pages; the player
  screen chooses the player (`PlaybackService`), draws its view under the
  app's controls, turns with the device, and reports progress through the
  outbox. The built-in player plays Jellyfin — a file as it is, or a
  transcode — on phones and in a browser. Each player has its switch and
  "Play with it first", as device settings.
- **Watch status (database v5):** marking something watched and where
  playback stopped land in `watch_status` and the outbox together; the
  drainer carries them to the source, and until it has, rows, detail pages
  and Continue Watching show this device's state.
- **Storage:** SQLite (`expo-sqlite`) and the keychain on iOS and Android,
  which run a development build; IndexedDB and WebCrypto-encrypted secrets on
  the web, on a secure page. No development seed: set things up once, and they
  persist (`docs/getting-started`).
- **The service graph is a runtime singleton** (`src/composition/provider.tsx`)
  — a router remount must never rebuild it, and in development it survives
  Fast Refresh. That stays.
- **vitest** covers the database on both engines, every migration, the
  credential stores, the services, the account's flows, and two devices on one
  fake server — PocketBase's rules — on every pair of engines (`npm test`).

Do not assume anything else described here exists. Build it, then update the
docs in the same commit.

## Verify

```bash
npm run android         # once per native change: builds the development client (npm run ios likewise)
npx expo start          # once: generates the typed-route types
npm run typecheck       # the app, then the tests (test/tsconfig.json)
npx expo lint           # includes the import-boundary, Hermes and SQLite rules
npm test                # vitest: the database, the credential stores, the services
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

After a change to the account contract, run the sync repository's tests too:
`npm test` there today; from Phase 6, `go test ./...` and its harness, which
drives the real `sync/custom-server` plugin against the real server.

Never run Metro with `CI=1` while iterating: CI mode disables file watching.
