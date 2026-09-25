# Jellyfin

Self-hosted film and TV server, and the primary target. It can serve your library *and* hold your viewing state — Jellyfin already tracks what you have watched, so the app can keep in step with it.

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

Its sync role can only carry what a Jellyfin server has fields for: watch progress, played state and favourites. It has nowhere to put a theme preference, so it never receives one.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
