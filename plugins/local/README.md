# Local

This device only. A terminus rather than a transport, so local-only is an ordinary destination instead of a branch in the sync engine.

## Roles

**Sync** — carries your user state. No media role.

## Brings

Nothing — it has no media role.

## Connection

No fields: there is nowhere to connect to.

## Settings

No settings. Its single role starts **on** when you add a connection — adding a sync-only plugin is the opt-in — while every capability toggle, once there are capabilities, still starts off.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
