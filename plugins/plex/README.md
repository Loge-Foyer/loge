# Plex

Plex Media Server. Its own account and authentication model, which stays entirely inside this plugin.

## Roles

**Media.** No sync role: the server stays the master of what each
of its users watched. The app will read that and, with playback, write progress
back through the media role — never through a sync role.

## Brings

Movies and shows.

## Connection

- **Server URL** — required
- **Plex token** — required, stored as a secret; a credential, so it can be kept per profile

## Settings

None yet.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
