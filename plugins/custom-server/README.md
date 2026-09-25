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

Connection fields only. Its single role starts **on** when you add a connection — adding a sync-only plugin is the opt-in — while every capability toggle, once there are capabilities, still starts off.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
