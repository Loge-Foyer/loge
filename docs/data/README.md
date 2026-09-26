# Data

The local database: schema, migrations, repositories, and how offline behaviour
works.

## Today

Everything is **in memory**. `src/persistence/memory.ts` implements the
repository interfaces the services depend on (`src/services/ports.ts`), with the
database's rules, so the services cannot tell the difference. Nothing survives a
reload.

What the stand-ins already enforce, because the database will:

- **Two cascades.** A profile's per-profile values and preferences go when the
  profile does; a connection's per-profile values go when the connection does.
- **Rows only point at secrets.** A connection or a profile's row holds a
  `credentialsRef` and the names of the password fields that are saved
  (`secretKeys`), never a value.

## What is stored where

- **The device** — installed plugins, every connection (with its shared values
  and its `perProfile` mode), and the default profile.
- **A profile** — its own values for each connection that keeps values per
  profile (`ProfileValues`: fields, settings, a credentials ref, or `off` when
  the profile does not use that connection), and its preferences, today the
  home layout. Later its history, favourites and progress. Deleting the profile
  deletes all of it.
- **The credential store** — passwords, PINs and session tokens, by ref.

## Secrets change by replacement

A changed password is written under a **new** credentials ref. The rows are
saved pointing at it, and only then is the old ref deleted: a crash in between
leaves at worst an orphaned secret, never a row pointing at nothing. Removing a
connection deletes every ref it or any profile held first, because the
database's cascade cannot reach the credential store.

## Session tokens are bound to what signed in

A source's token lives in the credential store under a ref derived, never
stored: `session:{connectionId}:{shared|userId}`. It is saved together with the
identity it was issued for — the scope's connection-field values and its
credentials ref. A token whose identity no longer matches is discarded, so a new
server address, username or password (by ref rotation) signs in afresh with
nothing to remember. A profile's removal forgets its tokens along with its
secrets.

## Titles and artwork

Metadata from sources lives in the query cache, in memory, for now. A plugin
that declares `offlineMetadata` — stable ids and artwork versioned by tag — lets
the app keep its images on disk (`cachePolicy: 'memory-disk'`) while the
connection's "Keep metadata on this device" setting is on. The next phase makes
the metadata itself durable under the same switch.

## Next

The in-memory repositories are replaced, not the services:

| Platform | Database | Secrets, PINs, tokens |
| --- | --- | --- |
| iOS, Android | SQLite (`expo-sqlite`) | the keychain |
| Web | IndexedDB | encrypted in IndexedDB under a non-extractable WebCrypto key |

The web gets IndexedDB rather than SQLite compiled to WebAssembly, and not
localStorage: a local-first write stores the data and its change-journal entry
together, which needs real transactions. IndexedDB versions are the migrations —
explicit, sequential, committed.
