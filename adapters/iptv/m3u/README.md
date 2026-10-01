# M3U playlist

Live TV from an M3U or M3U8 playlist, with the XMLTV guide it names.

## Category

**IPTV** — `iptv/m3u`. Its channels show on the TV tab. Its connections belong
to the account.

## Brings

Live channels, grouped as the playlist groups them (`group-title`), with logos
and a guide.

## Connection

- **Playlist address** — required. Kept like a password: a provider's playlist
  address usually carries its sign-in.
- **Guide address** — an XMLTV guide, when the playlist does not name one.

## Platforms

iOS and Android.

## Status

Manifest only. Planned after the players (see Phase 9's list). Large
playlists need a channel table of their own and a streaming parser.

See `docs/writing-a-plugin/` at the repository root.
