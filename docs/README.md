# Documentation — Loge app

Everything about the client itself: how to run it, how it is put together, and
how each platform differs.

These pages describe the target architecture. Where a page describes something
that is not built yet, it says so.

| Topic | What it covers |
| --- | --- |
| [Getting started](getting-started/README.md) | Installing and running, the three ways into a first launch, your own server on your computer, backups, starting from scratch |
| [Architecture](architecture/README.md) | Layers, the composition root, the session gate, the plugin catalogue, sources, the account and its sync, the owner check, backups, state ownership |
| [Data](data/README.md) | The local database: account-wide and device-wide data, transactions, the change journal, syncing with your server, the backup file, migrations, secrets, the media cache |
| [Adapters](adapters/README.md) | Where the adapters live and how the boundary is kept, the five categories and their lists, scopes, the platform filter, registration, what an adapter is given and where its content appears |
| [Playback](playback/README.md) | Descriptors and players, choosing a player, device-wide selection, watch status and its outbox |
| [UI](ui/README.md) | Tamagui, the four tabs, Settings, Welcome and the account screens, artwork, the web |
| [Network](network/README.md) | Reaching a server: cleartext on both phones, and the client-certificate design that is not built yet |
| [Platforms](platforms/README.md) | What differs per target: [iOS](platforms/ios/README.md), [Android](platforms/android/README.md), [web](platforms/web/README.md) |
| [Development](development/README.md) | The verification pass, the tests, debugging on a device |

Start with getting started. Architecture explains why the boundaries are where
they are; read it before any structural change.
