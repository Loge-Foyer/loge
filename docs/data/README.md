# Data

The local database: what it holds, transactions, the change journal,
migrations, secrets, and what a backup brings back.

## Where things live

| Platform | Database | Passwords, PINs | Session tokens, the device key |
| --- | --- | --- | --- |
| iOS, Android | SQLite (`expo-sqlite`) | the keychain / keystore | the keychain, this device only |
| Web | IndexedDB | encrypted in IndexedDB | the same |

The services cannot tell which. They depend on `LocalDatabase` and
`SecureCredentialStore` (`src/services/ports.ts`); `src/composition/storage.ts`
builds the native side and `storage.web.ts` the web's.

The web does not get SQLite compiled to WebAssembly: expo-sqlite's web build is
alpha, and needs WebAssembly and COOP/COEP headers from whatever serves the
page. Nor localStorage: a local-first write stores the data and its journal
entry together, which needs real transactions.

## What is stored

- **The device** — installed plugins and the default profile, and every
  connection with its shared values and its `perProfile` mode.
- **A profile** — its own values for each connection that keeps values per
  profile (fields, settings, a credentials ref, or `off` when the profile does
  not use that connection), its preferences (today the home layout), and what
  sources answered it. Everything a profile owns cascades from `users`, so
  deleting the profile is one statement.
- **The credential store** — passwords, PINs and session tokens, by ref. A row
  holds a `credentialsRef` and the names of the password fields that are saved
  (`secretKeys`), never a value.

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

Every change to one of these appends a journal entry in the same transaction:

- a profile
- its preferences, key by key
- a connection
- a profile's values on a connection

An entry records the entity, its id, `upsert` or `delete`, when it happened,
and the row's new version. Entries point at data and never copy it, so nothing
secret can end up there. The database numbers them (`AUTOINCREMENT`), so they
keep the order changes committed, whatever the clock says.

Some writes are not journaled:

- Device settings. The default profile and the installed plugins belong to
  this device.
- What sources answered. It is a cache, not user state.
- Rows a cascade deleted. The parent's entry implies them.
- Writes that change nothing.

The journal belongs to the device, not to a profile. Deleting a profile is
itself a change, so its `user_id` in the journal does not cascade. This is the
one table with a `user_id` that does not.

Nothing reads the journal yet: the account phase's sync engine will drain it.

## Migrations

Migrations are numbered and committed, never edited once shipped, and never
destructive: viewing history is not disposable.

- **SQLite** — `src/persistence/sqlite/migrations.ts`, one transaction per
  step, recorded in `PRAGMA user_version`.
  - A step that rebuilds a table runs with foreign keys off. SQLite ignores
    that pragma inside a transaction, so it is set before `BEGIN`.
  - `foreign_key_check` must pass before such a step commits.
- **IndexedDB** — `src/persistence/indexeddb/migrations.ts`, one upgrade per
  database version, run by the browser's `onupgradeneeded`.

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
sessions derived from it.

## Session tokens are bound to what signed in

A source's token lives in the device-bound credential store under a ref that
is derived, never stored: `session:{connectionId}:{shared|userId}`.

It is saved together with the identity it was issued for: the scope's
connection-field values and its credentials ref. A token whose identity no
longer matches is discarded. A new server address, username or password (by ref
rotation) therefore signs in afresh, with nothing to remember.

## Backups

A phone backup can carry the database to another phone. This is what comes
with it:

- **iOS** — an encrypted backup restores passwords and PINs. Session tokens
  and the device key stay behind (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), so
  the restored phone signs in to each server as a new device. It does not
  share, and end, the old phone's sessions.
- **Android** — the database comes back, but no secret: keystore keys cannot
  be restored, so expo-secure-store's data is left out of Auto Backup.
  - A source whose saved password is gone is not signed in without it, because
    servers lock accounts after failed logins. It says it needs its password
    again, and the connection form asks for it.
  - A PIN that is gone lets its profile's owner in, as a child lock should,
    until the account phase brings "Forgot PIN".

The device key is kept out of the database for the same reason: a copy on a
second phone would sign both in as one device.

## What sources answered

The home, each row's grid and the detail pages already opened are kept on the
device, per profile and per source:

- **What is kept:** each source's answer for a row (its first page, in the
  source's own order), the grid's first page, Continue Watching, a show's
  seasons and episodes, and a detail page once it has been opened. Watch
  status is kept as the source reported it, inside each item. A separate
  watch-status cache, with the outbox that sends changes back, arrives with
  playback.
- **Only where allowed.** Nothing is kept unless the source declares
  `offlineMetadata` — stable ids, artwork versioned by tag — and the
  connection's "Keep metadata on this device" switch is on for that profile.
  Switching it off deletes what was kept.
- **Only for the values it was saved under.** Each entry carries the
  fingerprint of what the source ran with — its fields, settings and
  credentials ref. After a changed address, library selection or password,
  nothing saved before is shown. Changing a connection also purges its saved
  answers outright, in the same transaction.
- **A cache, not user state:** never journaled, and every read and write is
  best effort. A failure to save never fails a screen.

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
fails its test, as it would fail in a browser.
