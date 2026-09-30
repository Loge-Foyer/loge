# Stalker portal

Live TV, films and series from a Stalker (Ministra) portal — the middleware
behind many IPTV subscriptions for MAG set-top boxes. A portal signs a device in
by its MAC address.

## Category

**IPTV** — `iptv/stalker`. Everything it brings shows on the TV tab: Live,
Movies and Series. Its connections belong to the account.

## Brings

Live channels, in the portal's genres, with its guide; the portal's films and
series.

## Connection

- **Portal address** — required, as the provider gives it (`…/c/`, or
  `…/stalker_portal/c/`, or the script itself, `…/portal.php`).
- **MAC address** — required. Kept like a password: anyone with it and the
  portal's address can use the subscription. It must look like
  `00:1A:79:12:34:56`; dashes and lower case are read too.
- **Serial number**, **device id** and **signature** — only if the provider
  asks for them; kept like passwords too.

## How it talks to a portal

- **Finding the API.** For `…/c/` it tries `server/load.php`, then
  `stalker_portal/server/load.php`, then `portal.php`, once each, and keeps
  the one that shakes hands.
- **Signing in** is a handshake for a token, then `get_profile`, which says
  whether this MAC address may use the portal. A refusal — or a blocked
  subscription — is remembered, and nothing asks that portal again by itself.
  One sign-in serves every call that starts together.
- **As a MAG box:** its user agent, `X-User-Agent`, and
  `Cookie: mac=…; stb_lang=en; timezone=UTC`, with the token as a Bearer, and
  `JsHttpRequest=1-xml` on every call.
- **A token that runs out** answers "Authorization failed.": one more
  handshake for that call, never a loop; a second refusal is the portal no
  longer accepting this device.
- **Live TV:** `itv get_genres` (without "All") and `get_ordered_list`, paged as
  the portal pages. Catch-up comes from `tv_archive_duration`. The guide is
  `get_short_epg` for now and next on a few channels, and one `get_epg_info`
  for a longer window.
- **Playing** is `create_link` when something plays, its `ffmpeg ` hint
  stripped. A live link with no `.m3u8` is raw MPEG-TS, which AVPlayer does
  not play — the app then says which player would. `limit` means the
  subscription is busy on other devices.
- **Films and series** come from `vod get_ordered_list`, which mixes them;
  seasons and episodes from the same call with `movie_id` and `season_id`. An
  old portal that numbers a series' episodes on the series itself gets one
  season, played through the series with the episode's number. Pages come in
  the portal's own order for the sort asked — newest added, by name, by
  rating — not re-sorted.
- **A `cmd` never leaves memory,** and never goes into an id: on some portals
  it is the stream's address, sign-in and all. The session keeps only the
  endpoint and the token.

## Platforms

iOS and Android. Portals send no CORS headers, and a browser will not send the
cookie a portal needs, so it does not run on the web until something proxies
it.

## Status

The media role is implemented and tested against a fake portal built from
Ministra's own sources and established clients. **It has not met a real portal
yet**: that needs a portal and a MAC address, kept in a gitignored
`stalker.env`. Series are the likeliest to differ from portal to portal.

See `docs/writing-a-plugin/` at the repository root.
