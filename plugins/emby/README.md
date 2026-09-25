# Emby

Emby server. Closely related to Jellyfin — similar APIs without being identical, which makes it a good test of whether the shared vocabulary is genuinely shared.

## Roles

**Media** — exposes content. **Sync** — carries your user state.

## Brings

Movies and shows.

## Connection

- **Server URL** — required
- **Username** — required
- **Password**

## Settings

Every sync toggle defaults to **off**. Connecting this plugin for media does nothing to your viewing state until you switch it on.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
