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
- **MAC address** — required. Stored like a password — anyone with it and the
  portal's address can use the subscription — but shown as it is typed and
  when the connection is edited (`visible`): it is no secret to whoever holds
  it, and typed unseen it goes wrong. It must look like `00:1A:79:12:34:56`;
  dashes and lower case are read too.
- **Serial number**, **device id** and **signature** — only if the provider
  asks for them; stored and shown the same way.

## How it talks to a portal

- **Finding the API.** For `…/c/` it tries `server/load.php`, then
  `stalker_portal/server/load.php`, then `portal.php`, once each, and keeps
  the one that shakes hands.
- **Signing in** is a handshake for a token, then `get_profile`, which says
  whether this MAC address may use the portal. A refusal — or a blocked
  subscription — is remembered, and nothing asks that portal again by itself.
- **Calls that start together share everything,** because a portal keeps one
  token per MAC address and every handshake ends the one before it: one read
  of the saved session, one sign-in, one renewal. The sign-in runs on no
  caller's signal, so a list left while it loads fails nobody else.
- **As a MAG box:** its user agent, `X-User-Agent`, and
  `Cookie: mac=…; stb_lang=en; timezone=UTC`, with the token as a Bearer, and
  `JsHttpRequest=1-xml` on every call.
- **A token that runs out** answers "Authorization failed.": one more
  handshake for that call, never a loop — and none when another call renewed
  it meanwhile, which would end the token that call just got. A token refused
  straight after a sign-in the profile accepted means the session was ended
  from elsewhere, the same MAC address signing in on another device: the call
  says so, and it is not latched as a refusal.
- **Live TV:** `itv get_genres` (without "All") and `get_ordered_list`, paged as
  the portal pages. Catch-up comes from `tv_archive_duration`. The guide is
  `get_short_epg` for now and next on a few channels, and one `get_epg_info`
  for a longer window — the guide of every channel on the portal, which is
  shared by every list that asks in the same five minutes.
- **Answers about the whole portal** — `get_all_channels`, which a channel
  played before its list was read needs, and `get_epg_info` — get a minute,
  where a page gets fifteen seconds.
- **Playing** is `create_link` when something plays, its `ffmpeg ` hint
  stripped. A live link with no `.m3u8` is raw MPEG-TS, which AVPlayer does
  not play — the app then says which player would. `limit` means the
  subscription is busy on other devices.
- **Films** come from `vod get_ordered_list`, pages in the portal's own order
  for the sort asked — newest added, by name, by rating — not re-sorted.
- **Series** come from wherever the portal keeps them. A newer portal has a
  **section of its own**: `series get_categories` answers, and then every
  series is in `series get_ordered_list` — never among the films. An older one
  has no such section and mixes its series into `vod`, marked `is_series`. The
  categories are the question asked: asking a portal without the section for
  a list of series can hand back the films. Its answer is kept for the
  session, a "no such thing" included; a failure to ask is not — a portal that
  was slow once still has its series — so the question is asked again, and
  Series says what went wrong meanwhile.
  - **Where they share pages,** a page can hold none of the kind asked for. It
    reads on, three pages at most, rather than answer an empty page that
    claims more.
  - **Seasons and episodes** come from the same section, with `movie_id` and
    `season_id`. Where a season lists its episodes as numbers (`series: [1, 2,
    3]`) rather than rows — which is what the real portal does — those numbers
    are the episodes, and they need no call of their own. An older portal that
    numbers them on the *series* is handled the same way, one season deep.
  - **Every link is made on the films' side**, `vod create_link`, whichever
    section the series came from: a portal's series section lists, and answers
    nothing at all when asked for a link.
- **Ids carry what they name**, and each part is encoded: a portal's own ids
  hold colons (`18390:18390`), so `show:s:18390%3A18390` says a series, from
  the portal's series section, with that id.
- **A `cmd` never leaves memory,** and never goes into an id: on some portals
  it is the stream's address, sign-in and all. The session keeps only the
  endpoint and the token.

## Settings

- **Keep channels and the guide on this device** — on by default. Gates
  `offlineMetadata`: channel ids and a portal's films keep their ids, so the
  app may keep the channel list, each channel's day of guide, and the first
  page of films and series, per profile, and show them while the portal is
  away. Links are never kept.

## Platforms

iOS and Android. Portals send no CORS headers, and a browser will not send the
cookie a portal needs, so it does not run on the web until something proxies
it.

Two things the host has to be right about, both of them the app's and neither
this plugin's:

- **Cleartext.** A portal is almost always plain `http` on a non-standard
  port, so the host must allow it. The app does, for both phones — iOS through
  `NSAllowsArbitraryLoads` and Android through `usesCleartextTraffic`. A host
  that does not will see the handshake fail as `PROVIDER_UNAVAILABLE` before
  anything reaches the portal, which reads as "the portal cannot be reached"
  and looks nothing like a policy.
- **No ambient cookies.** This plugin sets its own `Cookie` header on every
  request and never reads `Set-Cookie`; its session keeps only the endpoint and
  the token. A host HTTP client with a cookie jar can merge a stored cookie
  into that header — on iOS `URLSession` seeds the header from the shared
  store and then *appends* the caller's with a comma, which stops the portal
  parsing past the first `;`, and the portal then refuses the MAC it never
  saw; on Android the jar replaces it, and `mac=` is lost. Either way it lasts
  until the stored cookie expires. The plugin must never come to rely on a
  jar, and the app's client gives it none (`credentials: 'omit'`).

## Status

The media role is implemented, tested against a fake portal built from
Ministra's own sources and established clients, and **run against a real
portal** — one sign-in, one MAC address, as one device.

What that portal showed: 96 genres and 4,658 channels, a day of guide per
channel, 14 films and 14 series on a first page of 8,975, a series' season and
its five episodes, and a link to play an episode and a channel. Two things it
taught, both now in the code above: it keeps its series in a section of its
own, and its ids hold colons. Its `get_short_epg` answers with the programme
on now and no more, so "now and next" shows one — the day guide, which comes
from `get_epg_info`, has the rest.

**One MAC address is one device** on a provider's side. Never invent a second
to try something, never sign in from two places at once, and never loop a
failed handshake: a refusal is latched on purpose.

See `docs/writing-a-plugin/` at the repository root.
