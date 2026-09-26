# WebDAV

Plain files on a NAS. No media server supplies titles or artwork, so this one infers what it can from filenames and is honest about the rest.

## Roles

**Media** — exposes content. No sync role.

## Brings

Files.

## Connection

- **Server URL** — required
- **Username** — a credential, so it can be kept per profile
- **Password**

## Settings

Connection fields only. Its single role can be switched off per connection without removing the connection.

## Status

Manifest only. No role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
