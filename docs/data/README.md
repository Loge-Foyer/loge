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

- a profile's name, and its PIN as an entry of its own — so a rename can never
  carry away a PIN set on another device
- its preferences, key by key
- a connection
- a profile's values on a connection

An entry records the entity, its id, `upsert` or `delete`, when it happened,
the row's new version, and a random change id. The account stores a change once
by that id, however often it is sent. It is random rather than built from the
device, because a backup restored onto the same phone repeats sequence numbers:
the account would take the new changes for old ones, answer that it had them,
and lose them. Entries written before the account phase have no id, and are
never sent.

Entries point at data and never copy it, so nothing secret can end up there.
The database numbers them (`AUTOINCREMENT`), so they keep the order changes
committed, whatever the clock says.

Some writes are not journaled:

- Device settings. The default profile and the installed plugins belong to
  this device.
- What sources answered. It is a cache, not user state.
- Rows a cascade deleted. The parent's entry implies them.
- Writes that change nothing.
- What arrives from the account. The sync engine writes it through
  `SyncDatabase.unjournaled`, a port only it and the account service receive:
  journaled, a pulled change would be sent straight back. Joining an account
  still *announces* this device's rows by hand (`journal.announce`), in the
  same transaction.

The journal belongs to the device, not to a profile. Deleting a profile is
itself a change, so its `user_id` in the journal does not cascade. This is the
one table with a `user_id` that does not.

The sync engine drains it to the account. It reads the journal inside a
transaction (`tx.journal`), and hears through `journal.subscribe` about every
commit that journaled something — never a rollback, a read or an unjournaled
write.

Where the device stands with its account is `sync_state`: one row, cascading
from the account's connection. It holds the device's place in the account's
log, how far the journal has been sent, and which of its changes the account
has not returned yet. Like device settings, it is never journaled.

## Syncing with the account

The account carries profiles, their PINs, their preferences, connections and
each profile's values on them. Other devices get them the next time they sync.

- **What never travels.** Session tokens, credentials refs, the account's own
  connection, a connection's sync role, device settings (the default profile,
  installed plugins), connections of plugins this build does not register —
  and passwords, except sealed, on an account that carries them. A connection
  lists the *names* of its saved passwords, so a device without them asks —
  "needs its password on this device" — instead of signing in with nothing. A
  password saved there stays listed when this device edits the connection
  without having it.
- **The PIN travels readable**, as a lock against the wrong family member
  rather than an account secret. It arrives in the credential store, under a
  fresh ref, never in the database. A PIN this device cannot read — after a
  restore — is not sent at all, rather than sent as "no PIN".
- **Passwords travel sealed**, on an account that carries `sealedPasswords`
  (below).
- **A connection new to this device** installs its plugin.
- **The first profile chosen** on a device without a default becomes it, as
  the first profile created does — so a device that joined an account does not
  ask "Who's watching?" at every launch.

Joining an account announces this device's rows as journal entries, and the
normal push uploads them. Which side wins where both hold something:

| Joining | Where both sides hold it |
| --- | --- |
| "Use the account's profiles" | the account's, for profiles, their PINs and preferences; this device's other profiles go |
| "Keep both", and connections under either choice | the account's, unless this device changed it since it last left an account |
| the account lost data (`reset`), or carries more | this device's |

Something deleted here since the device last left an account is not brought
back, and its delete is announced. Signing out keeps everything on the device
and records the journal's head (`leftAccountAt`).

### Passwords

**The sign-in rule.** A password is only ever used with the sign-in it was
saved for: its plugin, and its scope's address and account — the `url` fields
and the credential fields, resolved over the connection for a profile's own.
A pulled change that points a connection anywhere else leaves its passwords
behind, every profile's that moved with it included, and the device asks. It
holds on every account, sealing or not: whoever controls the account can
rewrite an address, and a password must never follow it. Other fields — such
as "local only" — are no part of a sign-in, or every toggle would make other
devices ask again.

**Sealed.** On an account that carries `sealedPasswords` the engine seals each
saved password of a connection, and of each profile's values on it, with the
account's vault key: AES-256-GCM over the password and its sign-in, bound to
the change it travels in and its field (`sc/sealed/v1|{syncKey}|{field}`). The
account stores `v1.{key id}.{…}`, which it cannot open. A password this device
cannot read, or one too long to travel, is left out and its name still goes;
a change too long with its seals goes without them.

**Arriving**, a seal is opened before the transaction — the credential store is
no part of one — and written under a fresh ref:

- Each is judged against the connection as the log stands at that change: the
  page's own upserts and deletes, folded over this device's rows. The
  transaction takes a ref only if its sign-in is still the row's.
- The first change to a scope on a page that holds what this device holds
  already gets no ref, so an echo writes nothing and purges nothing. Every
  other change gets one, so a page that goes A → B → A ends on A — PINs alike.
- A seal that does not open — another account's key, a newer version, another
  connection's — is left out, and the names still count.

**Two exceptions to rule 1**, both narrow:

- A connection that now signs in somewhere else takes the passwords off every
  profile whose sign-in moved with it, even one this device changed.
- A password a row lists but this device lacks is filled in from a seal made
  for that row's own sign-in, even from a change the device does not take —
  its own change still wins everything else. That is how every device ends up
  with every password, in whatever order the runs came.

A save here that moves a connection announces its profiles' rows again, after
it, so they go out sealed for where they sign in now.

**The vault key** comes from the account's plugin, once per run, and only when
something is to be sealed or opened. If it cannot be had, the run stops before
the page that needed it: applied without, the seals would be passed for good.
Signing in reads it while the sign-in is open, for the join. The plugin keeps
it in the account's session — the device-bound store, never the database,
never restored onto another phone — and signing out removes that.

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
  version-change transaction, so it can rewrite records.

Version 2 added the change ids and `sync_state`, and switched every
connection's sync role off. Until then, adding a sync-only plugin switched it
on by itself; from then on a connection carries state only once it is chosen
as the device's account.

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
