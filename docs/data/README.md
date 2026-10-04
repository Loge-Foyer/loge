# Data

The local database: what it holds, account-wide and device-wide, transactions,
the change journal, syncing with your server, the backup file, migrations,
secrets, and what a phone's own backup brings back.

This page describes the target. Database v8 — the account model, watch status
with its outbox, what this device keeps, the lists a profile owns and its
favourite channels — and the backup file are in place. Phase 4's model —
the account as one of the device's connections,
synced through a log, with passwords sealed on the device — is in this page's
history in git.

## Where things live

| Platform | Database | Passwords, PINs | Session tokens, the device key, the backup key |
| --- | --- | --- | --- |
| iOS, Android | SQLite (`expo-sqlite`) | the keychain / keystore | the keychain, this device only |
| Web | IndexedDB | encrypted in IndexedDB | the same |

The services cannot tell which. They depend on `LocalDatabase` and
`SecureCredentialStore` (`src/services/ports.ts`); `src/composition/storage.ts`
builds the native side and `storage.web.ts` the web's.

The web does not keep its data in SQLite compiled to WebAssembly: expo-sqlite's
web build is alpha, and needs WebAssembly and COOP/COEP headers from whatever
serves the page. Nor localStorage: a local-first write stores the data and its
journal entry together, which needs real transactions. WebAssembly runs on the
web for one thing only — sql.js, loaded to write or open a backup file.

## What is stored

**Account-wide** — with the account, on your server and in backups:

- **Profiles**, at most ten: a name, the ref of a PIN, and their preferences
  (today the home layout). Everything a profile owns cascades from `users`, so
  deleting the profile is one statement.
- **Source, IPTV and metadata connections**, with their shared values, their
  category, `enabled` and their `perProfile` mode. Every device on the account
  has them.
- **A profile's own values** on a connection that keeps values per profile:
  fields, settings, a credentials ref, or `off` when the profile does not use
  that connection.
- **What a profile watched, where the app keeps it** (v9): for a source that
  keeps no watch status of its own, on a tab the account keeps it on — one row
  per profile and thing watched, keyed by what it is apart from any source.
- **The account's own settings** (v9): which tabs it keeps watch status on.
  The account's, no profile's.

**Device-wide** — never leave the device:

- **Device settings:** the default profile, players (on or off, the default,
  their settings), sync settings, the Live group each profile chose last on
  each provider, and the profiles whose PIN this device decides for itself
  (`pins`). A setting that names a profile or a connection — the default
  profile, a Live group, a PIN — goes in the same transaction as the profile
  or the connection (`services/removal.ts`): no cascade reaches it.
- **A PIN this device decides** is its own, or none, in place of the
  account's: the setting holds a ref, the PIN lives in the credential store
  beside the account's PINs, and neither is journaled, pushed or backed up.
  Changing account — a sign-in that replaces, an import — takes this device's
  choices with the profiles; signing out keeps them. Every place that shows or
  checks a PIN asks for the one this device asks for (`effectivePinRef`); sync
  and backups only ever know the account's.
- **Sync-category connections:** your server's sign-in, a backup target.
- **The account's own rows**, never journaled, and all three cleared when the
  device changes account:
  - `account` — a single row: local or server, its id and name, and the server
    connection for a server account
  - `account_sync` — the checkpoint, and when it last synced
  - `backup_state` — per target, the `{ lineage, generation, etag }` last seen
- **What sources answered**, per profile: the media cache (below).
- **What a metadata adapter said items are** (v10), per profile: `identities`.
- **The change journal.**

**The credential store** holds passwords, PINs, session tokens and the backup
key, by ref. A row holds a `credentialsRef` and the names of the password
fields that are saved (`secretKeys`), never a value.

Relational columns are kept for what is filtered or sorted; values read whole,
such as a connection's fields, are JSON. `list()` returns profiles and
connections in the order they were created, from a `position` column, because
SQLite's rowids can be renumbered.

## Transactions

Every write is a transaction. A write that spans rows is one transaction: all
of it lands, or none. Examples are a connection together with every profile's
values on it, or the first profile together with the device's default.

**A transaction awaits nothing but the database.** IndexedDB commits a
transaction the moment it waits on anything else — a keychain call, WebCrypto,
a fetch — and SQLite would wait on itself for ever. So a service works in three
steps:

1. **Plan.** Read what is stored, and write any new secret under a fresh ref.
2. **Transaction.** Write the rows.
3. **Clean up.** Delete the secrets the rows no longer point at.

On SQLite every statement goes through one queue on one connection, and a
transaction holds the queue from `BEGIN IMMEDIATE` to `COMMIT`. expo-sqlite's
own helpers are not used, and lint rejects both:

- `withTransactionAsync` folds whatever else runs meanwhile into the
  transaction.
- `withExclusiveTransactionAsync` opens a second connection, on which foreign
  keys — and so every cascade — are off.

Foreign keys are switched on for each connection and read back, because
without them no cascade fires and nothing else would notice. An update is an
`UPDATE`, never `INSERT OR REPLACE`: replacing deletes the row first, and the
cascade would take its children with it.

IndexedDB has no foreign keys. The repositories delete a profile's or a
connection's rows themselves, through the `byUser` and `byConnection` indexes,
in the same transaction, and refuse a row whose profile or connection is gone.

## The change journal

Every change to account-wide state appends a journal entry in the same
transaction:

- a profile's name, and its PIN as an entry of its own (`userPin`) — so a
  rename can never carry away a PIN set on another device
- its preferences, key by key
- a source or IPTV connection
- a profile's values on a connection

An entry records the entity, its id, `upsert` or `delete`, when it happened,
and the row's new version. It points at data and never copies it, so nothing
secret can end up there. The database numbers entries
(`AUTOINCREMENT`), so they keep the order changes committed, whatever the clock
says, and a number is never used twice: a checkpoint cannot skip changes
written in the same millisecond. Entries the account has stored are pruned.

Some writes are not journaled:

- Device settings: the default profile, players, sync settings.
- Sync-category connections, and the account's own rows.
- What sources answered. It is a cache, not user state.
- Rows a cascade deleted. The parent's entry implies them.
- Writes that change nothing.
- What arrives from the account. The sync engine writes it through
  `SyncDatabase.unjournaled`, a port only it and the account service receive:
  journaled, a pulled change would be sent straight back. Rows the server lost,
  and a local account's rows when it is uploaded to a new server account, are
  *announced* by hand (`journal.announce`) in the same transaction, for the
  normal push to carry.

The journal belongs to the device, not to a profile. Deleting a profile is
itself a change, so its `user_id` in the journal does not cascade. This is the
one table with a `user_id` that does not.

The sync engine reads the journal inside a transaction (`tx.journal`), and
hears through `journal.subscribe` about every commit that journaled something —
never a rollback, a read or an unjournaled write. The same signal tells a
backup target that there is something to save.

## Syncing with your server

On a server account, each run pushes the journal, reads the whole account, and
reconciles; `docs/architecture` has the steps. The server keeps one record per
profile, PIN, preference, connection and profile's values, keyed by the app's
own ids. Deletes are soft, so every device learns of one by reading, and a
server restored from an old backup can be told apart from a deletion.

- **Passwords travel in plain text**, in the `secrets` of each connection and
  each profile's values, because the server is the household's own. They are
  read from the keychain for a push, outside any transaction, and written to
  the keychain under fresh refs before a reconcile — never into the database.
  That makes the server's data folder as sensitive as every password the
  household uses; `../foyer` says how to keep it.
- **The PIN travels readable**, as a lock against the wrong family member
  rather than an account secret. It arrives in the credential store, under a
  fresh ref, never in the database. A PIN this device cannot read — after a
  restore — is not sent at all, rather than sent as "no PIN".
- **A connection lists the names of its saved passwords,** so a device where
  one is missing asks — "needs its password on this device" — instead of
  signing in with nothing.
- **What never travels:** session tokens and credentials refs, `position` and
  `version`, device settings, sync-category connections, and connections of
  plugins this build does not register.
- **A connection new to this device** is simply there: sources and IPTV belong
  to the account, and nothing needs installing. One whose plugin cannot run
  here stays inert, labelled "not available on this device".
- **The first profile chosen** on a device without a default becomes it, as
  the first profile created does — so a device that signed in does not ask
  "Who's watching?" at every launch.

Conflicts are resolved per entity, never globally and never by a clock: a
pending local change goes next and wins; a delete of a profile or a connection
always wins, and a later write to it gives way; otherwise the last push wins,
the whole entity at once. Every device applies the same server state, so they
converge.

**Nothing in an apply may fail on the data.** Each write is checked, then made:
on IndexedDB a failed request aborts the whole transaction even when caught. A
record that `isAccountRecord` refuses, or whose parent is gone, is skipped and
logged — never its payload.

## The backup file

A backup is one encrypted SQLite file, `.logebackup`, written by
`services/backup/`. It holds the account: its name, its profiles and
their PINs, preferences, and source and IPTV connections with each profile's
values — and their passwords, so nobody types a Jellyfin password again on a
new device. It never holds caches, device settings, players, sync settings,
tokens, the device key, the journal or sync state.

- **It is not a copy of the device database.** It has its own versioned schema,
  because the web has no device SQLite, and the device database never holds a
  secret:
  - `meta` — the lineage, the account's name, the app version
  - `profiles`, `pins`, `preferences`
  - `connections` and `profile_values`, each with a `secrets` JSON column

  Row shapes are the server's records' shapes, so one mapper serves the
  server, the upload to a new server account, and backups
  (`services/backup/database.ts`): an export writes `recordsOfAccount`, an
  import reads records back and applies them as a sign-in's replace does. The
  tables are plain, never WAL, with `application_id` (`LGBK`) and
  `user_version`.
- **Built and read in memory,** never opened as a database the app runs on:
  expo-sqlite's `serializeAsync` / `deserializeDatabaseAsync` on native, and
  sql.js (WebAssembly) on the web, loaded only when a backup is written or
  opened.
- **Encrypted as a whole.** A 76-byte header, then AES-256-GCM over the
  serialized database (`services/backup/container.ts`). The header holds the
  magic `LGBK`, the format and schema versions, the key id, the lineage (the
  account's id, hashed — the database inside holds it whole), the generation
  (+1 each save), the writer (this install, hashed), when it was created, and
  the nonce. Its first 64 bytes are the additional data, and the nonce — its
  last 12 — GCM authenticates by itself, so no byte of it changes unnoticed.
  Anything over 64 MiB is refused before it is read; a typical file is under
  1 MB.
- **The backup key** is 20 random bytes, shown as eight groups of four in
  Crockford base32 plus a checksum group, and forgiving when typed. The file's
  encryption key and key id are derived from it with HKDF. It is kept in the
  device-bound store, and shown only after the owner check, because it opens
  every password in the file. A lost key means an unreadable backup, and the
  app says so.
- **Importing** checks everything before it replaces anything: size, key id,
  decryption, `quick_check`, schema version, and every row against the record
  guards. Then the secrets go into the keychain under fresh refs, the rows are
  written in one transaction, and the janitor runs. The result is always a
  local account.
- **Backup targets** save the same file after changes, debounced, and when the
  app goes to the background — one file per account, named after its lineage.
  Writes are conditional on the etag last seen (`backup_state`, device state);
  when the file changed elsewhere the app asks — open theirs, keep this
  device's, or keep both, which gives this device's account a lineage of its
  own — and never overwrites. An account on your server just saves over its
  file: its devices hold the same account. To move from iCloud to Google, copy
  the file and import it with the key.

A backup target is not live sync between devices. Your own server is.

## Migrations

Migrations are numbered and committed, never edited once shipped, and never
destructive: viewing history is not disposable.

- **SQLite** — `src/persistence/sqlite/migrations.ts`, one transaction per
  step, recorded in `PRAGMA user_version`.
  - A step that rebuilds a table runs with foreign keys off. SQLite ignores
    that pragma inside a transaction, so it is set before `BEGIN`.
  - `foreign_key_check` must pass before such a step commits.
- **IndexedDB** — `src/persistence/indexeddb/migrations.ts`, one upgrade per
  database version, run by the browser's `onupgradeneeded`. A step gets the
  version-change transaction, so it can rewrite records, and aborts on any
  error.

The steps, the same on both engines:

- **v1** — the tables.
- **v2** — the journal's change ids, and Phase 4's `sync_state`.
- **v3** (Phase 6) — plugin ids qualified by category, wherever one is stored:
  `jellyfin` becomes `sources/jellyfin`.
- **v4** (Phase 6) — the account model:
  1. Phase 4's account — every sync-category connection — goes. Its
     secrets are queued for deletion first: its password, each profile's, and
     every session it kept. The cascade takes its values, its cache and
     `sync_state`.
  2. `sync_state` goes; `account`, `account_sync` and `backup_state` arrive.
  3. A connection's roles become `enabled`: off only where its media role
     was. Its category is its id's first part, and needs no column.
  4. Device settings lose `plugins` — a connection is what puts a source in
     use now — and `leftAccountAt`. Players' settings arrive with the players
     screen.
  5. The journal is cleared. Its entries were for the old log, and an account
     now starts with a full upload or a full download. Sequence numbers carry
     on: none is ever used twice.

  On IndexedDB each version opens in a version-change transaction of its own,
  so a step reads what the step before it committed.

  Then, before the gate, `ensureAccount()` gives a device that has profiles a
  local account, named after its default profile, or else its first; a device
  without profiles meets `needs-account`. Every profile, connection and
  password survives. An account on Phase 4's server is signed in to again, on
  the new server.
- **v5** (Phase 7) — watch status and its outbox (`docs/playback`):
  - `watch_status`, keyed `(user_id, connection_id, external_id)`: this
    device's state for an item it played or marked — the `WatchStatus`, the
    item as last seen (only where its metadata may be kept) and when.
  - `outbox`: reports waiting for the source, in `seq` order, with their
    attempts and when to try again. An item's newest progress replaces the
    progress before it, a stop takes that progress along, and the newest
    watched state replaces the one before it (`persistence/outbox.ts`), so an
    evening offline stays a short queue.
  - Both cascade from `users` and `connections` — on IndexedDB through their
    `byUser` and `byConnection` indexes — and neither is journaled, carried
    to your server or written into a backup. A phone restored from another's
    backup clears the outbox: its old positions would overwrite newer ones.
    Watch state nothing waits for is pruned after 30 days.
- **v6** (Phase 10) — `downloads`: what this device keeps, one row per item
  per profile, cascading from `users` and `connections` the same way.
  - Device state like the watch cache: never journaled, never carried to your
    server, never written into a backup — a file on this phone is this
    phone's, and nothing on another device can play it.
  - **No address is stored.** A download's URL can carry an `api_key`, an HMAC
    signature or a session token, so the row holds the item, the chosen option
    and the file name, and the address is asked for again when a download
    starts and when it resumes — exactly as playback asks again.
  - The file itself lives in the document directory, not the cache, which the
    system empties under pressure. A cascade cannot delete from disk, so the
    queue sweeps files no row points at on every pass.
- **v7** (Phase 10) — `subscriptions` and `playlists`: the first state the app
  owns itself, as against state a media server masters.
  - **Account-wide**, unlike the `downloads` beside them: journaled, carried to
    your own server, written into backups, because a channel someone follows is
    the profile's and belongs wherever it signs in.
  - A subscription cascades from its connection as well as its profile —
    unfollowing is implied by the source going away. A playlist does not: it
    may mix sources, and losing one connection is no reason to lose the list.
  - A playlist's items are one column, not rows: a list is edited as a whole,
    which is also why the whole-entity conflict rule is the right one for it.
  - **Backup schema 2** adds both. A file written at 1 still opens — it simply
    has neither — because only a *newer* schema is refused.
- **v8** — `favorite_channels`: the ★ a profile keeps before a provider's
  groups, one row per channel per profile, with its name, number and logo as
  they were when chosen, so the list reads while the provider is away.
  - **Account-wide**, as subscriptions are, and the same way: journaled one
    record each (`favoriteChannel`), so two devices adding different channels
    never overwrite each other and a removal wins on its own.
  - It cascades from its connection as well as its profile: a channel goes
    with its source.
  - **Backup schema 3** adds it. Files at 1 and 2 still open, for what they
    hold.
- **Two things a backup got wrong until v8**, fixed with it: the reader took
  only a file of exactly the current schema, so a file at 1 was refused as
  damaged and every backup would have been the day the schema moved; and the
  export never gathered subscriptions or playlists, so no backup held them.
  Any schema up to the current one opens now, and a backup holds everything a
  profile keeps for itself.
- **v9** — `watch_progress` and `account_settings`: watch status the app keeps,
  for sources that keep none — IPTV films and series, web video, plain files —
  on the tabs the account keeps it on, and those settings themselves.
  - **Keyed by what was watched, not where.** `watchIdentity` in `@loge/api`
    names it by the catalogue a source matched it to — `tmdb:movie:603`,
    `youtube:…` — else, for an IPTV provider that keeps each language's copy
    apart, its plain title and year; an episode is its show's identity with its
    season and number. A row's id is `<profile>/<hash of that>`: two devices
    that start the same film offline write the same row, so no second unique
    index can be broken.
  - **Account-wide**: journaled, on your server, in backups. It cascades from
    its profile alone: history outlives a source, as a list does.
  - **Merged field by field** on the client (spec §10): a later `round` —
    "mark as unwatched" — wins whole; within a round watched holds and the
    position is the last push's, so a rewind reaches every device.
  - **A snapshot** of the item last played — which source, which item, its
    title and cover — so the Live tab lists what is being watched with no
    request; it comes back from the account untrusted, and is checked first.
  - While something plays, a minute's progress at a time is written, every
    pause and stop always: each write is journaled, and an account on your
    server syncs soon after.
  - **Backup schema 4** adds both. Files at 1 to 3 still open.
- **Fixed with v9:** two devices that favourited or followed the *same*
  channel offline made two records of it, and the second broke every later
  reconcile on the unique index. The smaller id now wins on every device, and
  the other is deleted on the account.
- **v10** — `identities`: what a metadata adapter — TMDB — said an item of an
  IPTV provider is, keyed by profile, connection and item: its catalogue ids,
  or `NULL` for "asked, nothing close enough".
  - **Why.** A portal keeps a copy of a film for each language, each its own
    item under its own name, and often says nothing more. Until its copies
    carry one id, watching the German copy leaves the English one unwatched.
  - **Device state, like the media cache:** never journaled, never synced,
    never in a backup — a device without it asks again. It cascades from the
    profile and from the source whose item it names, and is purged with the
    media cache when that connection's values change: another portal at the
    same connection may mean another film by the same id.
  - **Laid on before an item is keyed:** the watch service reads it
    (`withKnownIds`) before `watchIdentity`, so a film found to be
    `tmdb:movie:238` is kept there; an episode takes its series' entry.
  - **A miss is asked again after thirty days**; a hit is kept.
  - **What was kept under the title moves** — in one journaled transaction,
    the row under the catalogue's id written, merged with any already there,
    and the title's removed — so every device of the account follows. Watched
    holds if either was; where it got to is the one touched last.
- **v11** — the TV tab became **Live**, and the two device settings that named
  it say so: the tab the app opens on (`app.openOn`), and the player first on
  each tab (`players.tabs`). A device that already chose for Live keeps that
  choice. Nothing else changes, and no table does.
  - **The account's watch-status setting keeps `tv`.** It is journaled, on
    your server and in every backup, and older apps read it by that name, so
    the app translates at the setting's edge (`RECORD_KEYS` in
    `services/account-settings.ts`) rather than renaming a record.
  - A tab the app no longer has is never opened: `openOn` falls back to Media.

The media cache survives v3 and v4: its fingerprints and the installation ids
never contained a plugin id, so Jellyfin sessions and device ids outlive the
rename.

A database written by a newer version of the app is refused rather than
guessed at, and the boot screen says so. In a browser, a tab still open on the
old version closes its connection when another tab upgrades, and asks to be
reloaded.

## Secrets change by replacement

A changed password or PIN is written under a **new** ref, the rows are saved
pointing at it, and only then is the old secret deleted.

The keychain cannot list what it holds, so deletions are queued. A ref the rows
stop pointing at goes into `stale_secrets` in that same transaction. It is
deleted from the credential stores right after the commit, and at the next
launch if a crash came in between.

At worst a crash leaves an orphaned secret, never a row pointing at nothing.
Removing a connection or a profile queues every ref it held, including the
sessions derived from it and a PIN this device kept for the profile.

## Session tokens are bound to what signed in

A source's token lives in the device-bound credential store under a ref that
is derived, never stored: `session:{connectionId}:{shared|userId}`.

It is saved together with the identity it was issued for: the scope's
connection-field values and its credentials ref. A token whose identity no
longer matches is discarded. A new server address, username or password (by ref
rotation) therefore signs in afresh, with nothing to remember.

Your server's session lasts 30 days, and is refreshed on every sync. When it
ends — a long time offline, or the password changed elsewhere — the plugin
signs in once with the saved password, and a refusal parks the account until
the user signs in again.

## Phone backups

A phone's own backup can carry the database to another phone. That is not the
`.logebackup` file above, and this is what comes with it:

- **iOS** — an encrypted backup restores passwords and PINs. Session tokens,
  the device key and the backup key stay behind
  (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), so the restored phone signs in to
  each server as a new device, rather than sharing — and ending — the old
  phone's sessions. Opening a `.logebackup` there takes the key, typed in.
- **Android** — the database comes back, but no secret: keystore keys cannot
  be restored, so expo-secure-store's data is left out of Auto Backup.
  - A source whose saved password is gone is not signed in without it, because
    servers lock accounts after failed logins. It says it needs its password
    again, and the connection form asks for it.
  - A PIN that is gone lets its profile's owner in, as a child lock should —
    the account's, or one this device kept: its choice comes back with the
    database, and on iOS its PIN with the passwords.
  - The backup key is gone too.
- **Either way,** a device-key fingerprint in the database spots the restore
  at boot: the pending journal and the session are dropped, and the next
  sign-in replaces what is on the device, so a stale journal is never pushed
  over what other devices did meanwhile.

The device key is kept out of the database for the same reason: a copy on a
second phone would sign both in as one device.

## What sources answered

The home, each row's grid and the detail pages already opened are kept on the
device, per profile and per source:

- **What is kept:** each source's answer for a row (its first page, in the
  source's own order), the grid's first page, Continue Watching, a show's
  seasons and episodes, and a detail page once it has been opened — and for
  IPTV, the channel list and the guide (Phase 7). Watch status is kept as the
  source reported it, inside each item; what this device changed since lives
  in `watch_status` and the outbox (v5), and is laid over it until the source
  has heard.
- **Live TV is kept beside the lists** (`MediaCacheRepository.value` /
  `putValue`), under keys of its own in the same table: `live:groups`,
  `live:channels:<group>` (a group's first page), `guide:<channel>:<day>` —
  one channel's UTC day, merged as windows of it arrive, pruned after a week —
  and `source:<kind>:<sort>`, a provider's first page of films or series. The
  same rules hold: only where `offlineMetadata` is in effect, only under the
  fingerprint it was saved with. A link to play is never kept.
- **Only where allowed.** Nothing is kept unless the source declares
  `offlineMetadata` — stable ids, artwork versioned by tag — and the
  connection's "Keep metadata on this device" switch is on for that profile.
  Switching it off deletes what was kept.
- **Only for the values it was saved under.** Each entry carries the
  fingerprint of what the source ran with — its fields, settings and
  credentials ref. After a changed address, library selection or password,
  nothing saved before is shown. Changing a connection also purges its saved
  answers outright, in the same transaction.
- **A cache, not user state:** never journaled, never synced, never in a
  backup, and every read and write is best effort. A failure to save never
  fails a screen.

How screens use it:

- **While a source answers**, a row shows what was saved as a placeholder. It
  never passes for a fresh answer, and a grid never pages on from a saved page.
- **When a source cannot answer**, what was saved stands in, and the notice
  says how old it is: "Home is not reachable right now. Showing what was saved
  5 min ago." A source that says an item is gone (`NOT_FOUND`) drops it from
  what is kept.
- **Pruning.** Rows, grids and Continue Watching are replaced on every
  refresh. Details and episode lists nobody has opened for 30 days are deleted
  at launch.

Artwork has its own cache: expo-image keeps images on disk (`cachePolicy:
'memory-disk'`) under the same switch, and a browser its HTTP cache. Saved
items resolve their artwork before the source has answered, so a saved row has
its posters.

## Tests

The app's database code runs on the real engines, in memory:

- **SQLite** through `node:sqlite`, with that driver's own foreign keys off, so
  only the app's pragma turns them on.
- **IndexedDB** through fake-indexeddb.

One contract suite runs against both. The service tests use the same databases,
and the credential store they get settles on a later macrotask, as a keychain
or WebCrypto does. A service that awaits it inside a transaction therefore
fails its test, as it would fail in a browser. Backups round-trip on both
engines, with sql.js standing in for expo-sqlite in Node.
