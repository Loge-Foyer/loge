# Data

The local database: schema, migrations, repositories, and how offline behaviour
works.

## Today

Everything is **in memory**. `src/persistence/memory.ts` implements the
repository interfaces the services depend on (`src/services/ports.ts`), with the
database's rules — a profile's own connections go when the profile does — so the
services cannot tell the difference. Nothing survives a reload.

## Next

The in-memory repositories are replaced, not the services:

| Platform | Database | Secrets and PINs |
| --- | --- | --- |
| iOS, Android | SQLite (`expo-sqlite`) | the keychain |
| Web | IndexedDB | encrypted in IndexedDB under a non-extractable WebCrypto key |

The web gets IndexedDB rather than SQLite compiled to WebAssembly, and not
localStorage: a local-first write stores the data and its change-journal entry
together, which needs real transactions. IndexedDB versions are the migrations —
explicit, sequential, committed.

What is stored where:

- **The device** — installed plugins, whether each is configured per profile,
  its shared connections, and the default profile.
- **A profile** — its own connections (for per-profile plugins), and later its
  history, favourites and progress. Deleting the profile deletes all of it.
