# iCloud

Apple's storage and sync. As a media source it reads video files from iCloud Drive; as a sync target it carries everything — profiles, preferences, progress, favourites, lists, home layout — between a person's own Apple devices.

## Roles

**Media** — exposes content. **Sync** — carries your user state.

## Brings

Files — video files on iCloud Drive.

## Connection

No fields: it uses the Apple account already on the device.

## Settings

Every sync toggle defaults to **off**. Connecting this plugin for media does nothing to your viewing state until you switch it on.

Both roles are independent: you can sync to iCloud without ever browsing Drive, and vice versa.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
