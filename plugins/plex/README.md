# Plex

Plex Media Server. Its own account and authentication model, which stays entirely inside this plugin.

## Roles

**Media** — exposes content. **Sync** — carries your user state.

## Brings

Movies and shows.

## Connection

- **Server URL** — required
- **Plex token** — required, stored as a secret

## Settings

Every sync toggle defaults to **off**. Connecting this plugin for media does nothing to your viewing state until you switch it on.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
