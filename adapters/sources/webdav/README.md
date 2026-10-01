# WebDAV

Plain files on a NAS. No media server supplies titles or artwork, so this one infers what it can from filenames and is honest about the rest.

## Category

**Source** — `sources/webdav`, in `adapters/sources/webdav`. Its connections belong to the account, and each can be switched off without being removed.

## Brings

Files.

## Connection

- **Server URL** — required
- **Username** — a credential, so it can be kept per profile
- **Password**

## Settings

Connection fields only.

## Status

Manifest only. No media role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
