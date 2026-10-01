# Yattee Server

Backend for YouTube and other web video, presented in the same vocabulary as a film from a home server.

## Category

**Source** — `sources/yattee`, in `adapters/sources/yattee`. Its connections belong to the account, and each can be switched off without being removed.

## Brings

Videos.

## Connection

- **Server URL** — required

## Settings

Connection fields only.

## Status

Manifest only. No media role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
