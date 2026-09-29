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
  `…/stalker_portal/c/`).
- **MAC address** — required. Kept like a password: anyone with it and the
  portal's address can use the subscription.
- **Serial number** and **device id** — only if the provider asks for them;
  kept like passwords too.

## Platforms

iOS and Android. Portals send no CORS headers, and a browser will not send the
cookie a portal needs, so it does not run on the web until something proxies
it.

## Status

Manifest only; built in Phase 7. A portal that refuses the MAC address is
never tried again by itself, and a channel's link — which carries a session
token — lives in memory only.

See `docs/writing-a-plugin/` at the repository root.
