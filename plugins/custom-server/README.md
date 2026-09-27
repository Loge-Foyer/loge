# Custom server

Talks to a sync server you run yourself. Pairs with the streaming_center_sync repository.

## Roles

**Sync** — carries your user state. No media role.

## Brings

Nothing — it has no media role.

## Connection

- **Server URL** — required
- **Access token** — required, stored as a secret

## Settings

Connection fields only. It becomes your account only when you choose it in Settings → Account.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
