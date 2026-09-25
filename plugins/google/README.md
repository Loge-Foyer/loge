# Google

The Android counterpart to iCloud. Reads video files from Drive as a media source, and carries the same broad set of user state as a sync target.

## Roles

**Media** — exposes content. **Sync** — carries your user state.

## Brings

Files — video files on Google Drive.

## Connection

No fields yet: signing in is an OAuth flow that arrives with the implementation.

## Settings

Every sync toggle defaults to **off**. Connecting this plugin for media does nothing to your viewing state until you switch it on.

Both roles are independent.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
