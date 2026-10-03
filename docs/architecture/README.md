# Architecture

Layers, the composition root, state ownership, and the rules that keep plugins
from leaking into screens. The full reasoning is in
`../../../.claude/architecture.md`.

This page describes the target. The four tabs, plugins by category and
platform, and one account per device — kept here or on your own server,
synced record by record — are in place; backups and players are not.

## Layers

```
src/
  app/          routes only (expo-router); each file renders a screen
  screens/      screen bodies — kept apart so TV layouts can be new screens
  components/   the design system, on Tamagui; takes domain types only
  hooks/        React bindings: query hooks, the session gate, the account's status
  services/     business logic, no React; ports.ts declares what they need
  persistence/  the local database: SQLite (native) and IndexedDB (web)
  platform/     device boundary: credentials, HTTP, network, identity, clock, logging,
                the device owner's check, app activity, the run lock, cryptography, files
  composition/  builds the service graph; the only place that names a plugin
```

The app has no native code of its own: native code comes with player
plugins, in their packages.

Dependencies point inward. Services depend only on the interfaces in
`services/ports.ts` — never on a repository implementation or a platform module.
Screens and hooks reach services through `useServices()`, never through
`composition/`. Only `src/app/_layout.tsx` mounts the composition root, and only
`composition/` chooses implementations. Lint enforces all of it.

## The composition root

`composition/services.ts` wires the graph; `composition/provider.tsx` builds it
**once per JavaScript runtime**, not once per mount. The router may remount the
root layout — after a deep link, or the browser's back button — and that must
never produce a second graph, which would open the database a second time. In
development the graph is kept on `globalThis` for the same reason: Fast
Refresh re-runs the provider's module after an edit, so a changed service
needs a reload. The same file wires TanStack Query's focus manager to
`AppState`, so returning to the app refreshes what is stale.

`composition/storage.ts` builds the native storage — SQLite and two keychain
services — and `storage.web.ts` the web's: IndexedDB, and secrets encrypted in
IndexedDB. Metro picks the file by platform, so neither side ships the other's
code. The databases open on first use, and launching goes in this order:

1. Delete the secrets a crash left queued.
2. Make sure the device has an account (`ensureAccount`): a device that has
   profiles but no account record — one upgraded from Phase 4 — gets a local
   one.
3. Make the boot decision.
4. Start the sync scheduler. The engine never runs before the gate has
   settled.

A storage failure lands on the boot screen's "could not start".

The composition root is also where plugins are registered
(`composition/plugins.ts`), where each role is handed to the one service that
calls it, and — once players exist — where a player's view is imported.
Screens resolve all of it through `useServices()`.

## Cryptography

Plugins have no cryptography of their own — no WebCrypto, no timers, nothing
host-side — so the app hands them one through their context
(`PluginContext.crypto`), and keeps one definition of it:
`platform/plugin-crypto.ts`. The backup file uses the same parts. They are
chosen by file, like storage:

- **Encrypting** is AES-256-GCM through expo-crypto, with WebCrypto behind it
  in a browser. It runs natively on a phone, which matters: plain JavaScript
  on Hermes is about a hundred times slower, and a backup file can be
  megabytes. Additional data — a backup's header — goes in as base64 that
  `@loge/api` encoded: expo-crypto reads a string of additional data as base64,
  and would turn bytes into one through `btoa`.
- **Expanding a key** is HKDF-SHA-256 in JavaScript (noble): a few HMACs,
  cheap anywhere. The backup file's encryption key and key id come from the
  backup key this way.
- **Randomness** — the backup key, nonces — comes from expo-crypto.

Only `src/platform/` imports noble; lint enforces it.

- **Hashing** is SHA-256 in JavaScript (noble): a record's id on your own
  server is derived from it (`recordId`).

Nothing derives a key from a password any more. Phase 4 did, for its vault
and owner proof, with a native module: scrypt in plain JavaScript took 22 s on
the emulator.

## The local database

Services reach it through `LocalDatabase` (`services/ports.ts`). Called
directly, a repository method is a transaction of its own; several writes that
must land together go through `transaction(work)`, and `work` awaits nothing but
the repositories it is given. Every change to account-wide state — profiles,
their PINs and preferences, source and IPTV connections and each profile's
values on them — appends a change-journal entry in the same transaction. The
rules, and why each exists, are in `docs/data`.

## The session gate

`services/session.ts` owns a single gate: `starting`, `needs-account`,
`needs-first-user`, `needs-user-selection`, `needs-user-unlock`, `ready` or
`failed`. The first decision after launch is the pure function in
`services/boot.ts`, which reads whether the device has an account as well as
its profiles: with no account, it is `needs-account`; with an account that has
no profile left, `needs-first-user`. A device that always asks who is watching
— Settings → App, on by default on a TV — goes to `needs-user-selection`
whatever its default profile, and `session.refresh()` decides the same way, so
a sync arriving while the picker is up never walks past it. Every root route
sits behind exactly one `Stack.Protected` guard on that gate, so when the gate
moves, the guards do the navigating.

`index` is the first route behind the `ready` guard, so a guard flip lands
there — after the picker, the PIN pad or Welcome — just as a cold start does,
and it redirects to the tab this device opens on (`app.openOn`, Media unless
Settings → App says otherwise). A link that opened the app never passes
through it.

The screens the guards move between appear at once (`animation: 'none'`): a
flip replaces a root screen, and a native stack animates a replace as a push,
so each step from the splash to the tab slid in from the right. The switcher's
own modals, opened from inside the app, keep their slide. The splash stays up
until the gate has settled and this device's settings are read
(`useStartedAppSettings`), so the first frame has the scheme it keeps and
`index` redirects with no spinner between.

Everything a signed-in profile can reach lives in the `(app)` group: the tabs,
and the pages pushed over them — the full-screen grid, detail pages and the
customize sheet. Its layout is keyed by the active profile, so switching
profiles remounts all of it and nothing of the previous profile survives on
screen.

`(app)` is reachable while the gate is `starting`, too, showing the boot spinner
behind the splash screen. A link that opened the app keeps its target that way;
were `(app)` guarded until `ready`, the router would replace the link with the
boot screen before the app could honour it. If the gate settles anywhere else —
a PIN to enter, a profile to pick — the guards take over as usual and the link
is dropped.

Welcome, the first-launch screen, sits outside `(app)`, because it comes before
any profile exists. It offers three ways in:

- **Create an account on this device** — a name, which is also the first
  profile's.
- **Sign in to your server** — the server's account arrives with its profiles.
- **Restore a backup** — a `.logebackup` file and its key, which become a local
  account.

When a sync or an import brings or removes profiles, the engine tells the
composition, which has the gate look again (`session.refresh()`): to "Who's
watching?" when profiles arrive, to the picker when the profile in use is gone,
and back to `needs-account` when the account is gone. Nothing happens while
starting or failed, and a PIN set elsewhere never locks the profile in use. The
first profile chosen on a device without a default becomes its default, as the
first one created does.

## The plugin catalogue

`services/plugin-catalog.ts` holds every registered plugin, each checked with
`validateManifest` at startup: a broken manifest stops a development build, and
is left out of a production one.

- **Only this platform's plugins** are listed and run: those whose `platforms`
  include the one the app runs on (`runsOn` in `@loge/api`, against
  `Platform.OS`). An account-wide connection whose plugin cannot run here stays
  inert, labelled "not available on this device", and is kept for the devices
  that can. A stored plugin id names its category even in a build without the
  plugin.
- **One list per category** — sources, IPTV, players, sync, metadata — for
  the five rows of Settings → Adapters. There is no global list.
- **Each role goes to one service:** `media` to the media service, `player` to
  playback (Phase 7), `account` to the account service and its sync engine,
  `backup` to the backup service, `metadata` to the identity service. Nothing
  else ever holds one.

## Where a source comes from

Source and IPTV connections belong to the account: every device on it has
them. Each connection's `perProfile` mode decides what each profile keeps for
itself: nothing (`none`), its own sign-in (`credentials`), or its own value for
every field and setting (`all`). For the active profile, `services/sources.ts`
resolves each connection to one of three standings:

| Standing | When | What the profile sees |
| --- | --- | --- |
| live | shared, or the profile's own values are complete | the connection's titles |
| pending | the profile has not filled in its own values | "Finish setting up" on the tab its content belongs to |
| off | the profile was switched off for it | nothing at all |

A live source carries the values it runs with — shared values, with the
profile's own where the mode separates them — and `@loge/api`'s
`effectiveCapabilities(manifest, { enabled, settings })` runs on those resolved
values. A connection switched off has nothing in effect; otherwise a declared
capability is in effect when every toggle gating it is on. Under `all`, two
profiles can differ in what the same connection may do. The screens only ever
see that result.

**Where its content appears** is its category plus its content kind, mapped in
one place, `services/tab-content.ts`:

- a source's movies, shows and anime on Media
- a source's videos and files on Videos
- everything an IPTV plugin brings — live channels, and its movies and series —
  on TV, and a source's `live` channels there too

## Talking to sources

`services/media/` is the only place that calls a plugin's media role, for
sources and IPTV alike.

- **One provider per connection and credential scope** (`pool.ts`). Every
  profile sharing a login shares a provider and a session: a provider each
  would sign in again and again, and a server that allows one token per device
  would end each session with the next. A provider is replaced when the
  resolved values change — its fingerprint covers fields, settings and the
  credentials ref, never a secret: a changed secret gets a new ref.
- **It never throws.** Rows, the grid and Continue Watching fan out to every
  live source and merge what arrives; a source that failed comes back as a
  `SourceError` beside the others' results, and the home shows one quiet line
  for it.
- **Retry hints decide what happens next.** `backoff` rows are asked again every
  30 seconds. `network-change` parks the source: later calls return the parked
  error without touching the plugin until the network changes or the user
  refreshes. A failed sign-in (`UNAUTHORIZED`) parks it too, because servers lock
  accounts that keep trying.
- **Merging keeps the source's order.** Each plugin returns items in
  `compareItems` order; rows merge sorted lists, and the grid merges buffered
  pages that stop as soon as one source runs dry, because past that point the
  order can no longer be proved.
- **What a source answered is kept,** per profile, where the source allows it
  (`offlineMetadata`, and its switch). A source that fails is represented by
  what was saved from it, marked with when (`SourceError.savedAt`); on the grid
  only on the first page, as a finished source the merge never pages. At
  launch the hooks show saved rows as `placeholderData` from a second, local
  query — never `setQueryData`, which would make a snapshot look fresh and let
  the grid page from old positions.

## The account

A device holds exactly one account once it is set up: **local**, living on
this device alone, or **on your own server**. The `account` row says which,
and `services/account.ts` is the only thing that changes it:

| Action | What happens |
| --- | --- |
| Create a local account | a name, and a first profile with the same name |
| Sign in to your server | try once, read the whole account, confirm — with an offer to export a backup first, and the owner check — then replace this device's account in one transaction |
| Create an account on your server | from a fresh device, the server makes a first profile named after it (`firstProfile: true`); from a local account, the device uploads what it holds — refused up front when it has more profiles than the server takes |
| Sign out | a local copy stays, and becomes a local account |
| Switch | sign out, then sign in |
| Import a backup | the file's account replaces this device's, as a local account; a device signed in to your server signs out first, after asking |

Accounts are never merged. Your server's sign-in is a sync-category
connection: it belongs to the device, and is never journaled, pushed or
backed up. A build without the account's plugin shows the account as
unavailable, and can still sign out.

**It signs in once.** The try runs on a provider outside the pool, and the
session it made is handed to the account inside the run lock, so no run signs
in again. Once `createAccount` has succeeded, a failure after it is
`AccountCreatedError`, and the form only signs in from then on. Signing out
tells the server once, for at most five seconds, and lets it go whatever it
answers.

**The profile limit** is ten on a local account, and on your server the
`maxProfiles` that `info()` reads without signing in. The profiles service
refuses a profile past it.

## The sync engine

`services/sync/` keeps a server account and the device in step. An account is
small — at most ten profiles, their PINs and preferences, and a few
connections — so a run (`sync/engine.ts`) reads all of it:

1. **Push** (`sync/push.ts`) the journal after the checkpoint, as one batch the
   server stores all or nothing, parents first. Each journaled entity goes as
   its whole current row (`sync/records.ts`), with its passwords read from the
   keychain outside any transaction, or as a soft delete. A refused batch
   names the write that stopped it: a profile over the limit stays on this
   device only, with everything of it, and says so; a write to a deleted
   profile or connection gives way to the delete, with its children; one the
   server finds invalid is left out and logged, and not taken for lost until
   the app starts again. The rest is sent again, and the checkpoint moves past
   what was stored. "Everything of it" includes what a key does not name: a
   subscription's, a favourite's and a playlist's key is a generated id and
   their tombstone has no body, so whose they are, and which connection they
   hang off, come from their body or their journal entry.
2. **Read** every record of the account, deleted ones included, each checked
   with `isAccountRecord`.
3. **Reconcile** (`sync/reconcile.ts`). First the plan, outside any
   transaction: PINs and passwords go into the keychain under fresh refs. Then
   one unjournaled transaction:
   - an entity with a pending local change is skipped: this device's change
     goes next
   - a deleted profile or connection is deleted here, always
   - otherwise the server's version replaces the local one when they differ
   - a local row the server does not have, and that is not pending, was lost
     by the server — a restore — so it is announced again, and the next push
     puts it back
4. **Clean up.** Refs nothing adopted go through the janitor, "last synced" is
   recorded, and the engine tells its listeners what changed.

There are no cursors, revisions or logs: the server's collections are the
truth. Two devices editing the same profile or connection end on whichever
pushed last, never by a clock, and nothing is merged field by field.

- **When it runs** (`sync/scheduler.ts`): at launch, on coming to the
  foreground, two seconds after a journaled commit, when the network changes,
  every minute in the foreground, and on "Sync now" — never inside a write.
  Retry hints decide the rest: `backoff` starts at 30 seconds and doubles up to
  15 minutes, and nothing but the retry itself or a new network cuts it short;
  `network-change` waits for one; an account that refused the sign-in, or
  whose password is not on this device, waits for the user, always; a
  throttled sign-in (`too-many-attempts`) waits, since nothing judged the
  password. On the web a run holds a Web Lock, so two tabs never sync at once.
- **Afterwards** — after a run, and after signing in — the engine tells its
  listeners what changed: the composition lets running providers go and has the
  session gate look again; the UI refreshes what it shows.
- **A phone restored from its OS backup** keeps its database but not its
  device-bound keychain. A device-key fingerprint in the database spots it at
  boot: the pending journal and the session are dropped, and the next sign-in
  replaces, so a stale journal is never pushed.

On a local account there is nothing to sync. Its journal is pruned, since no
server waits for it, and a backup target, when there is one, saves after
changes instead.

## The owner check

`services/owner-check.ts` re-verifies whoever owns the device's profiles:

- **On a server account,** its password, typed again, checked by the server
  (`verifyOwner`) — never the saved one. Nothing typed is refused before
  anything is asked, so it never counts as a wrong try; a throttled check is
  `throttled`.
- **On a local account, or when the server has let this device go** — its
  password changed, or it answers `signed-out` mid-check — the device answers
  instead: Face ID, a fingerprint or the passcode, asked only from the platform
  layer.
- **Where neither exists** — a browser on a local account — a PIN stays until
  it is typed.
- A server that cannot be reached is `failed`, never a quiet fallback to the
  device.

It guards, on a device that holds profiles: Forgot PIN, signing out, replacing
or switching the account (asked of the account being left), importing a
backup, and showing the backup key. Signing in again to the same account does
not ask: its password is the proof. At first launch there is nothing to
protect.

## Backups

`services/backup/` writes and reads the account as one encrypted file,
`.logebackup`. `docs/data` has its format.

- **Writing:** the account's rows, mapped to the backup's own schema by the
  same mapper that makes the server's records, with passwords and PINs read
  from the keychain outside any transaction. The database is built in memory —
  expo-sqlite on native, sql.js on the web, loaded only then — serialized, and
  encrypted with the backup key.
- **Export and import** exist on every platform: the share sheet or a download
  out, the document picker or a file input in.
- **Importing** checks everything before it replaces anything — size, key id,
  decryption, `quick_check`, schema version, every row — then writes the
  secrets under fresh refs, the rows in one transaction, and runs the janitor.
  The result is always a local account.
- **Backup targets** (`services/backup/targets.ts`) — iCloud, Google Drive
  and OneDrive as their roles arrive, the mock in development — save the same
  file ten seconds after the last journaled commit, when the app goes to the
  background with something changed, and on "Save now". A target only stores
  bytes, and the file never touches the disk unencrypted.
  - **One file per account** on a target, named after its lineage: two
    accounts never share one, and only devices holding the same account can
    clash.
  - **Writes are conditional.** The service remembers `{ lineage, generation,
    etag }` per target (`backup_state`). A file this device has not seen, or
    one changed since, stands the target in conflict, and nothing is
    overwritten until the user chooses: *open theirs* (it replaces this
    device's account, after the owner check), *keep this device's*, or *keep
    both* — this device's account takes a new lineage and saves beside it.
  - **An account on your server** is the same on every device signed in to
    it, so its file is simply the last one saved: there is no conflict to ask
    about.

## Choosing a player

`docs/playback` has the design and the player screen. A source's
`getPlaybackDescriptor` says what to play, and a player plugin plays it.
`choosePlayer` in `@loge/api`, a pure function, picks the device's default if it
can play the item, else the best enabled player on this platform that can, and
otherwise says which one would. Players are device settings, and the chosen
player's view reaches the screen from the composition root.

## Query keys

Every key is prefixed with the active profile (`userKey`) or with `device`
(`deviceKey`). What a source answered also carries `remote`
(`remoteKey`), which splits it from local state:

- Local changes — renaming a profile, editing the home layout — refresh local
  keys only, never every server.
- Remote queries use `networkMode: 'always'`: a server at home answers without
  the internet, so React Query must never hold them back as "offline".
- Refresh — pull to refresh, or the web toolbar — unparks sources and
  invalidates the profile's remote keys; a changed network does the same.
- What the account brings refreshes local keys — remote ones too when a
  connection changed — and drops a removed profile's keys. `useSyncEffects`
  does it from the root layout, because Welcome is outside `(app)`.

## State ownership

| State | Lives in |
| --- | --- |
| The account-wide state — profiles, preferences, source and IPTV connections, per-profile values — and the change journal | repositories — SQLite on native, IndexedDB on web |
| Device settings — the default profile, players, sync settings — and sync-category connections | repositories, never journaled |
| The account: `account`, `account_sync` (the checkpoint, last synced), `backup_state` | repositories, never journaled, cleared when the device changes account |
| Passwords, PINs, your server's account password | the credential store — the keychain on native, encrypted IndexedDB on web |
| Session tokens, the device key, the backup key | the device-bound credential store — the keychain, never restored onto another phone |
| Playback descriptors and stream URLs | memory only |
| Reads for screens, titles from sources | TanStack Query, every key prefixed by `device` or by the active profile |
| The session gate | the session service, read with `useSyncExternalStore` |
| How the account stands — syncing, synced, waiting, changes not sent | the sync engine, read with `useSyncExternalStore` |
