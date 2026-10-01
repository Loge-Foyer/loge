# Xtream Codes

Live TV, films and series from a provider that speaks the Xtream Codes API.

## Category

**IPTV** — `iptv/xtream`. Everything it brings shows on the TV tab. Its
connections belong to the account.

## Brings

Live channels in the provider's categories, with a guide; the provider's films
and series.

## Connection

- **Server address** — required.
- **Username** — required; a credential.
- **Password** — required.

The API puts the password in every stream's address, so a stream's address is
held in memory only, never stored and never logged.

## Platforms

iOS and Android, until a proxy lets the web reach providers without CORS.

## Status

Manifest only. Planned after the players (see Phase 9's list).

See `docs/writing-a-plugin/` at the repository root.
