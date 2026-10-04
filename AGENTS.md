# AGENTS.md — loge

The Loge client: an Expo/React Native app targeting **iOS, Android and web**.
Read the workspace root `AGENTS.md` and `../.claude/architecture.md` first.

This repository owns **the experience**: screens, services, the local
database, the backup file's format, platform access and composition. It does
not own domain types or any adapter — those live in `adapters/`, beside it.

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
- **This app is past that point.** Simulators and the emulator run a
  development build: `npm run android` / `npm run ios` build and install it,
  then Metro serves the JavaScript as before. **A real iPhone or Apple TV gets
  a Release build** — `npm run ios:device` / `npm run tvos:device` — never the
  development client, which keeps a phone working for the computer while it
  runs: the bundle from Metro, sockets for Fast Refresh, DevTools and the
  console, and a network inspector copying every response to Metro, all over
  Wi-Fi on a phone paired that way. Never install from Xcode's Run button
  either: it attaches the debugger (`docs/platforms/ios`).
  - Player engines are native code: expo-video for the built-in player
    (Phase 7), and an Expo module for mpv.
  - Face ID needs the app's usage text, which Expo Go cannot carry.

  A native change means building again — a stale build looks like code that
  did not change. The web needs no build.
- **The version is `package.json`'s alone.** Never write one in `app.json`
  or by hand: `npm run release` moves the app and Foyer together, and
  `app.config.js` derives the build number from it (`docs/development`).
- Prefer recommended Expo modules over third-party libraries, and check your
  available skills before adding dependencies.
  Docs: https://docs.expo.dev/versions/latest/index.md

---

## Project invariants

These are specific to Loge and matter more than anything above.

1. **Never define a domain type in `src/`.** `MediaItem`, `GlobalMediaKey`,
   the capability types and every adapter contract live in `@loge/api`, and the
   React half of the player contract in `@loge/player-kit` — both under
   `adapters/`, in this repository but compiled as programs of their own.
   Defining them in `src/` makes the dependency graph circular, and one
   repository makes that *easier* to do by accident, not harder.

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
   player, sync or metadata package, and so a player's view. Screens resolve
   what they need from injected services. `@loge/player-kit` holds only types — the React
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
   - **Account-wide** — profiles, their PINs and preferences, and source,
     IPTV and metadata connections with each profile's values on them.
     Journaled, carried to your server, written into backups. What a profile keeps for itself on a
     connection — its values under the connection's `perProfile` mode — is
     user-owned and goes with the profile.
   - **Device-wide** — players (on or off, the default, their settings), sync
     plugins (your server's sign-in, a backup target and its key), the default
     profile, the Live group each profile chose last, a profile's PIN where
     this device decides its own (`pins`), sessions, the device key, caches,
     the journal and sync state. Never journaled, never pushed,
     never in a backup. A device setting that names a profile or a connection
     has no cascade: `services/removal.ts` drops it in the same transaction.

7. **Components take domain types.** `<PosterCard item={item} />`, never
   `<JellyfinPoster raw={payload} />`. Artwork goes through
   `components/artwork.tsx`, which resolves a reference through the media
   service — never a raw URI, because a reference may need an auth header that
   must not sit where a component can read it.

8. **Never try a failed sign-in again on your own.** Servers lock accounts
   after a few failures — Jellyfin, your own server and an IPTV portal alike. A
   source that answers `UNAUTHORIZED` is parked until the user acts, a plugin
   signs in once per 401 at most, and Test connection / Load libraries are
   buttons — never a probe while someone is typing. A real portal is reached
   as one device from anywhere — the app, a script, a test: the connection's
   MAC address and box ids and the adapter's own MAG User-Agent, never an
   identity of a client's own; each handshake ends every other place's token.

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
  latest three: v9 watch status the app keeps and the account's own
  settings, v10 what a metadata adapter said an IPTV title is, v11 the TV tab
  renamed Live in device settings. `docs/data` has what each does.
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
- **The backup database is not the device database.** A `.logebackup` has its
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
own server** (PocketBase, `../foyer`). It holds up to ten
profiles — fixed at ten locally, `info().maxProfiles` on a server
(`FOYER_MAX_PROFILES`, default 10). The `account` row says which it is;
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
- **Whose a record is never comes from its key alone.** A subscription's, a
  favourite's and a playlist's key is a generated id, and a tombstone has no
  body: the push takes the owner from the body, else the journal entry
  (`userId`). Judged by key alone, a held-back profile's lists went to a
  server that has no such profile, and were refused one round trip each.
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

`services/backup/` writes and reads the account as one encrypted `.logebackup`
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
- **Every schema this app ever wrote opens,** for what it holds; only a newer
  one is refused. A reader that took only the current schema would make every
  backup unreadable the day the schema moved on — which it did until v8, so a
  test now opens a file of each older schema.
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
- **Only the composition root imports a player package or `@loge/player-kit`.**
  Screens get the chosen player's controller and view from it through
  `useServices()`. The app never imports an engine — expo-video, hls.js, an
  Expo module — itself: that is the player plugin's (lint). It installs them,
  as the player's peers, so that autolinking builds them and Metro bundles one
  copy of each.
- **Choosing is `choosePlayer` from `@loge/api`, and pure:** the device's
  default if it can play one of the item's sources, else the first enabled
  player on this platform that can, else none — and the app says what would
  ("This channel needs a player that plays MPEG-TS."). Never by an engine's
  name.
- **A descriptor lives in memory only.** Never persisted, never in the media
  cache, never logged; redaction covers URLs and MAC addresses. `headersRef` is
  resolved by the engine at load time, never inlined.
- **Who keeps watch status is `Source.watch`** — the source, the app, or
  nobody — and nothing else decides it. A source that keeps its own keeps it;
  the app never keeps it a second time.
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
- **Reading ahead is the device's, and decided once** — Settings → App →
  Buffering, `PlayerPreferences.buffering`, and `bufferingFor` in `@loge/api`
  per stream: never on disk for a live stream, which would only grow, nor for
  a file on the device. An engine claims disk with `buffersOnDisk` in its
  profile and nothing else; Settings offers Disk only where one here does.
- **One stream per subscription line.** Engines are let go through
  `PlaybackService.release`, never `dispose()` straight, and a channel's link
  is asked for only once none is left: a zap replaces the player screen, and
  the leaving one's engine outlives the new one's start.
- **A channel comes back by itself** (`useLiveRecovery`): three tries at
  most, never after a refused sign-in or a failure not to repeat. Never
  write another retry loop around a stream.
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
  out of `platforms`; never work around that in the app. The development mock
  portal, which reaches no portal, is the one exception.
- `web.output` is `"single"` — an SPA. Nothing is pre-rendered; do not add
  `+html.tsx` or server-only assumptions.
- `src/app/_layout.tsx` imports `@tamagui/core/reset.css`; without it browser
  defaults (button padding) break components.
- Tabs on web are `src/components/app-tabs.web.tsx`, a top navigation bar.
- A browser's `fetch` must be called unbound (`const { fetch } = deps`), and a
  page on `https` cannot reach an `http` server on the local network.

---

## Apple TV is iOS with a remote

`npm run tvos` builds it; `docs/platforms/tvos` explains everything below.

- **`react-native` is react-native-tvos, for every build.** Its prerelease
  versions fall outside ordinary semver ranges, so `overrides: {
  "react-native": "$react-native" }` keeps one copy — without it npm nested a
  second and a third React Native — and `expo.autolinking.exclude` names
  react-native-tvos, which autolinking otherwise links as a module of its own.
  Run `npx expo-doctor` after touching either: it finds duplicates.
- **`ios/` is an iPhone project or a TV one, never both.** `scripts/ios-target.js`
  switches it with a clean prebuild. A build of the wrong kind fails to install
  or builds the wrong thing; a stale one looks like code that did not change.
- **The scene life cycle is required** from iOS and tvOS 27
  (`config-plugins/with-scene-lifecycle.js`): an app that makes its window in
  the app delegate traps at launch. Remove the plugin only when Expo's
  template adopts scenes itself — it throws when the template changes.
- **Never import, at the top of a platform module, an Expo module with no tvOS
  build** — brightness, screen orientation, local authentication, the document
  picker, sharing. Autolinking leaves them out of a TV build and their
  JavaScript throws on import. Load them on first use (`await import(…)`) and
  give the TV a stand-in, as `src/platform/` does. The TV is told apart at
  runtime (`Platform.isTV`), never by file name, so one bundle serves both.
- **A TV keeps nothing durable:** no downloads, no files to move, and a
  database the system may clear on a real Apple TV. Do not build on local
  storage surviving there.
- **No focus request reaches a native modal on tvOS.** react-native-screens
  presents one outside React Native's root view, where `hasTVPreferredFocus`,
  `nextFocus*` and a focus guide's destinations do nothing; `autoFocus` and
  the traps still work. A screen that must place the focus is pushed on a TV
  — the player is (`playerOptions`), and so are who is watching and a
  profile's PIN (`profileGateOptions`).
- **Menu pops a pushed screen before React Native hears it** — UIKit's own
  recognizer on the navigation controller, even with
  `TVEventControl.enableTVMenuKey()` on (react-native-screens #4618). A screen
  whose Back must close layers first holds Menu through `TvMenu.hold()`
  (`modules/loge-tv-menu`, counted with React Native's one global switch),
  listens on `BackHandler`, and leaves through `close()` itself: `exitApp`
  does nothing on tvOS. Never call `enableTVMenuKey()` or
  `disableTVMenuKey()` anywhere else — one flag, and the first to turn it off
  takes it from everyone. Delete the module when react-native-screens with
  `disableDefaultMenuAction` (#4665) arrives.
- **The tabs are a rail down the left** (`components/tv-tabs.tsx`), not
  UIKit's tab bar: on tvOS a tab bar controller has no sidebar, and the bar
  across the top sat over each tab's own. The rail is `expo-router/ui`'s
  headless tabs, as the browser's bar is; select sends the focus into the
  page (`requestTVFocus()` on its focus group), and the rail closes.
- **Only the screen in front acts on the remote.** TV events reach every
  mounted screen, and a zap leaves the player before on the screen for a
  moment: gate `useRemoteKeys` on `useIsFocused()`.
- **Nothing beneath the player polls or ticks.** The tabs stay mounted under
  it; live queries' `refetchInterval` and `useNow` stop while their screen is
  not focused, and move on at once when it is again.

## iOS and Android run Hermes

Hermes lacks built-ins that Node and browsers have — `Array.prototype.toSorted`,
`Object.groupBy`, `crypto.randomUUID`, `Uint8Array.prototype.toBase64`, and
possibly `structuredClone`, `Promise.withResolvers` and
`Intl.RelativeTimeFormat`. Code using them typechecks, passes vitest (Node) and
works on the web, then throws on a phone: Continue Watching broke exactly like
that. Lint rejects them in `src/`; copy and sort (`[...list].sort(compare)`)
instead, and turn bytes into text with `@loge/api`'s helpers. Plugins run on
Hermes too — the adapters' own tests scan for the same gaps. The app's
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
  base64 that `@loge/api` encoded: never raw text, never bytes.

---

## The adapters

`@loge/api`, `@loge/player-kit` and every adapter live in **`adapters/`**, in this
repository, as npm workspaces:

```jsonc
// package.json
"workspaces": [
  "adapters/api",
  "adapters/player-kit",
  "adapters/sources/*",
  "adapters/iptv/*",
  "adapters/players/*",
  "adapters/sync/*",
  "adapters/metadata/*"
]
```

They were a repository of their own until Phase 9. The reason was sideloading
third-party plugins, which mobile cannot do; what the split actually bought was
a boundary `tsconfig` and lint already enforce, and what it cost was two
`node_modules`, a Metro resolver rewriting every import of every plugin file, a
block list, and the duplicate-native-package hazard that once built that
repository's `expo-modules-core` 57.0.20 under this app's 57.0.19. All of that
machinery is gone: there is one `node_modules`, so there is one copy of React,
React Native, expo and expo-video, and nothing has to arrange it.

**The boundary did not move, and is still the point.**

- **`adapters/tsconfig.json`** compiles `api` and the sources, IPTV and sync
  adapters with `lib: ["esnext"]` and `"types": []` — no `fetch`, no `URL`, no
  `console`, no timers. They reach the host only through the context they are
  handed.
- **`adapters/tsconfig.players.json`** is the players' own program, with React
  Native's types and the DOM's, because an engine has to draw.
- **This repository's `tsconfig.json` excludes `adapters/`.** Compiled into the
  app's program they would inherit Expo's types, React Native's and the DOM's
  — exactly what they must not have. One repository makes that mistake easier,
  not harder, so the exclusion is load-bearing.
- **`npm run typecheck`** runs all five programs: the app, its tests, and the
  adapters' three.
- **vitest runs two projects**, named in `vitest.config.mjs` — the app's suite
  and the adapters'. They are named explicitly because npm workspaces would
  otherwise be auto-detected as projects, and this app's tests would run under
  the wrong root.
- **Register an adapter in `src/composition/plugins.ts`** — still the only file
  that may import one; lint enforces it. Every adapter exports `plugin`: its
  manifest, and the one role its category's block promises.

**Native code still belongs to players alone**, in their own `android/` and
`ios/` folders, and autolinking finds them through `expo.autolinking`
(`searchPaths: ["./node_modules"]`, where the workspace links are, and
`nativeModulesDir: "./modules"` for the app's own). After touching a player,
check that nothing comes from anywhere unexpected:

```bash
npx expo-modules-autolinking resolve --platform apple --json
npx expo-modules-autolinking resolve --platform android --json
```

**One copy of a native library, and the newest.** React Native and libmpv each
carry a `libc++_shared.so`, and an APK holds one: the first the
merge sees, which is React Native's — and which libmpv cannot load. A source
set of the app's own wins the merge, so `config-plugins/with-newest-libcxx.js`
points one at what mpv's module unpacks. **Packaging is the app's**: no adapter
can see what another's engine put in the same APK. libmpv also asks for Android
8, so `expo-build-properties` sets `minSdkVersion` to 26.

**A player's native code means building again.** A stale build looks like code
that did not change. Verify with a real export and a real build, not a
typecheck.

## UI

- **Tamagui 2.7.7** (`v5` preset) is the one component system. Pin every
  `@tamagui/*` package to the same exact version.
- **One theme entry point:** `src/tamagui.config.ts`. Never add a second theme
  or styling system beside it. Its colours are `src/tamagui.themes.ts`, apart
  only so `test/theme.test.ts` can read them without React Native; nothing
  else imports it. `@expo/ui` came with expo-router: never build a screen
  from it. Where a native control is wanted that Tamagui has no equal for —
  a menu of choices, as a series' seasons on a phone — use its universal
  `Picker` (`appearance="menu"`) inside a `Host`, themed with the page's
  colours.
- **Two schemes, light and dark**, as Settings → App → Appearance says: greys
  for the page and its words, the brass accent for what is pressed and
  chosen. Write a token, never a colour that assumes one scheme. Status words
  are step 11 (`$red11`…: step 10 fails on white). What is drawn over a
  picture — the player, a poster's badges — is `<Theme name="dark">`, dark in
  both. The fill is `$accentBackground` with `$accentColor` on it; never pair
  accent steps by hand for one, since the light theme turns Tamagui's pair
  round (`tamagui.themes.ts`). A chosen option wears that fill too
  (`CHOSEN`, `components/settings-list.tsx`) — never `theme: 'accent'`, whose
  page is paler than an unchosen button in light.
- v5 is **shorthands-only** (`bg`, `p`, `rounded`, `items`…); media keys are
  min-width (`$sm`, `$md`, `$lg`, `$xl`).
- Native-drawn chrome (NativeTabs, stack headers, native switches) takes
  resolved colours: `String(theme.x.val)`. The native side follows the app's
  Appearance through `Appearance.setColorScheme`, and the root view takes the
  page's colour (`components/theme-root.tsx`).
- Scrolling surfaces are React Native `ScrollView`/`FlatList`, not Tamagui's;
  the full-screen grid is `@shopify/flash-list`, keyed by its column count.
- v5 views default to `position: static` on the web. An overlay's container
  (badges on a poster, text over a hero) needs `position="relative"`, or the
  overlay lands on some ancestor — right on a phone, wrong in a browser.
- React Native components take `pointerEvents` in `style`; the prop is
  deprecated.
- Screen kinds come from `src/components/stack-options.tsx`: tab root,
  full-screen page, detail (transparent header), sheet.
- **A sheet's page is `SheetScreen`** (`components/sheet.tsx`): one
  `ScrollView`, its title the first, sticky row. An iOS form sheet stretches
  the scroll view it finds over the whole sheet unless it is the second of
  exactly two children, so anything put beside it — a title, Done — is drawn
  under the content.
- **A button over a picture goes in a native header** where there is one —
  iOS 26 draws its glass round it, Android its toolbar — and is
  `HeaderButton`'s dark circle anywhere else (`components/header-button.tsx`).
  Never add a glass library for the rest.
- **A title's sheet** (`titleOptions`, Media's `mobile/title-sheet.tsx`) is
  one `ScrollView`, and every modal it opens is drawn inside it; on Android
  it is `nestedScrollEnabled`, so its content scrolls before the sheet moves.
  An iOS form sheet shows a native header only around a stack of its own, so
  on an iPhone the sheet holds one (`title/_layout.tsx`); Android's cannot
  hold a nested stack, and floats its ✕ in a sticky bar instead.
- **On a TV, a scroll view follows the focus with snap markers**
  (`SnapPoint`, `snapToAlignment="item"`), never by scrolling itself, and
  what the remote reaches never moves or grows as the focus moves: draw the
  difference, do not lay it out. A card that widened its frame sent the
  remote to the end of its row (`docs/platforms/tvos`).
- **Each content tab is its own UI, and so is each form factor in it:**
  `src/tabs/<tab>/{shared,mobile,tv}`, with an `index.ts` that takes the
  screens from `tv` or `mobile` at runtime (`isTV`) — `mobile` is a phone, a
  tablet and a browser. Routes import only `@/tabs/<tab>`. Lint
  (`import/no-restricted-paths`) refuses a tab importing another, `mobile` and
  `tv` importing each other, `shared` importing either, and anything outside
  `src/tabs` but a route reaching in (`docs/ui`).
- **Four tabs:** Media, Videos, Live, Settings. Settings → Adapters is five
  rows — Sources, IPTV, Players, Sync, Metadata — each opening that category's
  list for this platform (`settings/adapters/[category]`, then
  `[category]/[name]`: the id's two parts are the two segments, so no id is
  ever URL-encoded). There is no global list.
- Forms render from manifests (`src/components/manifest-form/`), switching on
  `field.type` only. Never write a form for a specific plugin.
- **A button comes from `@/components/button`, never from Tamagui** — lint
  refuses it. Tamagui's controls hear touches alone, and a TV remote's select
  arrives as a click only React Native's `Pressable` hears: `remotely()`
  (`components/remote.tsx`) draws a control inside one on a TV, with a focus
  ring. Something already a `Pressable` shows its focus with
  `useRemoteFocus()`. Focus that is not shown is a remote that does not work.
- **A size written by hand goes through `px()`** (`components/density.ts`):
  on a TV the theme's tokens are 1.5 times a phone's, and a bare number stays
  phone-sized beside them. Margins at the sides of a page are `GUTTER`.
- **An adapter's id goes into a route through `routeId` and comes out through
  `fromRouteId`** (`components/media/item-link.ts`). expo-router decodes a
  param twice — parsing the path or query, then in `useLocalSearchParams` —
  so an id holding `%` arrives changed: a Stalker series id
  `show:s:18390%3A18390` came out `show:s:18390:18390`, and every series
  failed to open. Use `itemHref`, `keyHref`, `playHref` and `liveHref`
  rather than spelling a pathname with an id in it.

---

## Skills

`.agents/skills/` in this repository:

- **`loge-verify`** — the full verification pass. Use before committing.
- **`loge-run`** — launch on simulator, emulator or browser.
- **`loge-use-plugin`** — wiring an adapter into the app.

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

**Phase 7 — it plays. Phase 8 brought more players; VLC left in Phase 9, and is back.**
Everything above describes the target; what runs today:

- **Four tabs** — Media, Videos, Live, Settings. Live holds one IPTV provider at
  a time: Live with group chips, channels with now and next, a day guide per
  channel, channels played live with channel up and down; its films and
  series as posters. Settings → Adapters is five lists, by category, of the
  plugins that run on this platform. Stored plugin ids are qualified by
  category (database v3).
- **One account per device,** local or on your own server (database v4).
  Welcome creates one on the device, or signs in to your server. Signing in
  replaces the device's account; signing up with an invite uploads it; signing
  out keeps a local copy. A run pushes the journal as batches, reads the whole
  account and reconciles by the four rules; a profile over the server's limit
  stays on this device only. Your own server is PocketBase
  (`../foyer`), and its password, typed again, is the owner
  check. The dev-only mock is a pretend server in memory. Ten profiles at
  most, or the server's limit.
- **Media is real,** and modelled on a streaming service's
  (`docs/ui/media`): Continue Watching, Downloaded, and the profile's own rows
  — each one kind or several, of every category or of one ("Comedy" across
  films and series) — chips that narrow the whole home, a full-screen grid per
  row, and a search page over every Media kind; from every live source,
  merged, and kept per profile where the source allows it. On a phone and in
  a browser: a glow behind the top, a hero with Play and Details, posters
  without words, and a title's sheet that rises to the top of the safe area.
  On a TV: a top bar, rows whose focused title is drawn as a scene and held
  on the left, More… after twenty, and a title's page whose Episodes and
  More like this slide in from the right. Jellyfin and the mock implement the
  media role.
- **Videos is real too**, and shows one source at a time: source tabs, kind
  tabs where a source brings more than one, a paging grid of landscape cards,
  and a search box only where `search` is in effect. `RowSpec.connectionId`
  is what scopes the merged grid to one source — Media merges, Videos does
  not, and that is the whole difference. `sources/yattee` is the first source
  that brings `videos`.
- **The backup file:** Settings → Adapters → Sync exports it — the share sheet
  on a phone, a download in a browser — imports it, and shows its key behind
  the owner check; Welcome restores one. Backup targets keep it saved, asking
  before they overwrite a file another device changed; the dev-only mock
  target is the only one with a role so far. sql.js is its own lazily loaded
  chunk on the web.
- **Playing:** Play, Resume and Mark watched on detail pages; the player
  screen chooses the player (`PlaybackService`), draws its view under the
  app's controls, turns with the device, and reports progress through the
  outbox. The built-in player plays Jellyfin — a file as it is, or a
  transcode — on phones and in a browser; mpv plays too, an Expo module in its
  adapter, on Android and (built, not yet played) on iPhone, and so does VLC,
  on Android, iPhone and Apple TV. Each player has its switch, "Play
  with it first" and first on a tab, as device settings; "Play with…" on a detail
  page picks one for an item, and never falls back to another.
- **Search is closed:** a term rides on a query that already names its kinds,
  so there is no screen that searches everything — Media's search page asks
  for every Media kind, and nothing else. `RowSpec.term` goes into the merged
  grid and `ChannelQuery.term` into the Live sections; only sources whose
  `search` is in effect see one. A search is never saved, and nothing saved
  stands in for one. It starts once typing stops for two seconds, or at once
  on the search key — on Videos, on the key alone — and a list is never keyed
  by its term, because the box lives in its header and the keyboard went with
  each remount.
- **Settings → App:** what the app does by itself on this device, as against
  what a plugin does. Its Appearance (`appearance`: System by default, Light
  or Dark — the theme, and the native chrome with it). The tab it opens on (`openOn`, Media by default —
  `src/app/index.tsx` redirects there at a cold start and after a profile is
  picked), whether it asks who is watching at every launch
  (`alwaysChooseProfile`: off on a phone, on on a TV, from `appDefaults`), and
  force landscape on playback, on by default, and a title's buttons as
  symbols or with their words (`buttonLabels`, symbols by default). Players also carry this
  device's own order (`players.order`), which is the order they are listed
  *and* tried in.
- **Watch status (database v5):** marking something watched and where
  playback stopped land in `watch_status` and the outbox together; the
  drainer carries them to the source, and until it has, rows, detail pages
  and Continue Watching show this device's state.
- **Watch status the app keeps (database v9, backup schema 4):** for a source
  that keeps none, on the tabs Settings → Watch status keeps it on — the
  account's setting. One journaled row per profile and thing watched, keyed
  by `watchIdentity` (the TMDB id a portal matched it to, else its title),
  merged field by field on sync; the Live tab lists what was begun first, and
  every card has its check.
- **Metadata (database v10):** a fifth adapter category, and TMDB in it, with
  the household's own key — account-wide, like a source. Items an IPTV
  provider names only by their title are looked up as they are drawn
  (`IdentityService`, four at a time); the answer is kept on the device, laid
  on before an item is keyed, and what was kept under the title moves to the
  TMDB id. Never by name above the composition root: the lookups branch on the
  `iptv` category and `Source.watch`, and the adapter's own page shows what a
  manifest's `attribution` says, under Credits.
- **Credits:** each adapter's page ends with what it is built on or talks to,
  from its manifest's `credits` for this platform (`creditsOn` in
  `@loge/api`), as rows that open the address (`LinkRow`) — and About opens
  Loge's own source. The GitHub mark is chosen by the address, never by the
  plugin; a TV shows the address, having no browser.
- **Downloads:** Settings → Downloads holds Options — what to ask a source
  for, which does not drive a download yet — then what is kept. Media's home
  has a Downloaded row after Continue watching (home layout version 2), and a
  kept copy's page opens and plays with no network, from where it was asked.
- **PIN lock per device:** a profile's PIN is asked on All devices — the
  account's, as before — or on This device: its own, or none, whatever the
  account says (`DeviceSettings.pins`, `services/device-pins.ts`). No
  migration: a device setting holding a ref, the PIN in the credential store,
  never journaled, synced or backed up, and dropped with the profile and with
  a replaced account. `toAppUser(user, pins)` makes `pinProtected` the PIN
  this device asks for; sync and backups keep the account's ref.
- **Favourite channels (database v8, backup schema 3):** a ★ before a
  provider's groups on Live, kept per profile on the account; holding a channel
  — holding select, with a remote — adds it or takes it out.
- **Artwork is resolved again once its source is ready** — connected, or
  answered — so a card drawn from what was saved does not keep its plate.
- **Stalker:** its MAC address and the box's other ids are shown, still
  stored as passwords (`PasswordField.visible`); a Guide time zone setting
  turns a guide stamped on the portal's wall clock back into instants; calls
  share one sign-in properly, and plugin requests carry no ambient cookies.
  Another country's guide, written in UTC and taken for the portal's own
  clock, is put right by each channel's country — its guide id, group or
  name (`countryOf`) — with no setting to touch.
- **On a TV, a channel is watched with the controls away:** a banner as it
  opens or zaps, up and down zap, select brings the controls, and Back closes
  the channel list, a panel, the controls and the banner before it leaves —
  Menu included, held for the app by `modules/loge-tv-menu`. A channel whose
  stream stops comes back by itself.
- **Buffering** in Settings → App: Off, Memory or Disk with its limit, which
  mpv honours with a disk cache and the other engines in memory.
- **Yattee** pictures come from the addresses the server signs for them.
- **Apple TV:** the app builds, installs and runs on the tvOS 27 simulator
  (`npm run tvos`), driven by the remote: every control focusable and
  pressable, TV-sized type and spacing, the tabs down the left, Media's
  rows with the focused title held on the left, and the player on play/pause
  and the arrows. Brightness, orientation, Face ID,
  files and downloads are stand-ins there.
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
npx expo export --platform ios --output-dir /tmp/loge-ios
npx expo export --platform web --output-dir /tmp/loge-web
```

After a change to the account contract, run the sync repository's tests too:
`npm test` there today; from Phase 6, `go test ./...` and its harness, which
drives the real `sync/custom-server` plugin against the real server.

Never run Metro with `CI=1` while iterating: CI mode disables file watching.
