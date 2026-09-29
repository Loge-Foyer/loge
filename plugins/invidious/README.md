# Invidious

A privacy-respecting YouTube front end. Instance-based, so the connection form collects an instance URL rather than an account.

## Category

**Source** — `sources/invidious`, at `plugins/sources/invidious` once Phase 6
regroups the folders (today `plugins/invidious`). Its connections belong to the account, and each can be switched off without being removed.

## Brings

Videos.

## Connection

- **Instance URL** — required

## Settings

Connection fields only.

## Status

Manifest only. No media role is implemented yet, so no capability is declared —
capabilities arrive with the code that honours them.

See `docs/writing-a-plugin/` at the repository root.
