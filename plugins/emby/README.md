# Emby

Emby server. Closely related to Jellyfin — similar APIs without being identical, which makes it a good test of whether the shared vocabulary is genuinely shared.

## Category

**Source** — `sources/emby`, at `plugins/sources/emby` once Phase 6
regroups the folders (today `plugins/emby`). Like Jellyfin, the server stays the master of what each of its users watched. The app will read that and, with playback, write progress back through the media role — never through the account.

## Brings

Movies and shows.

## Connection

- **Server URL** — required
- **Username** — required; a credential, so it can be kept per profile
- **Password**

## Settings

None yet.

## Status

Manifest only. No media role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
