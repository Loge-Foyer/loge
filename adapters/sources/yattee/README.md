# Yattee Server

YouTube and other web video from a server the household runs itself, presented
in the same vocabulary as a film from a home server.

## Category

**Source** — `sources/yattee`, in `adapters/sources/yattee`. Its connections
belong to the account, and each can be switched off without being removed.

## What it talks to

[`yattee/yattee-server`](https://github.com/yattee/yattee-server): FastAPI over
yt-dlp, with an **Invidious-compatible API** and **HTTP Basic Auth on
everything** once setup is complete. It is not Invidious, and not Piped —
`sources/invidious` is a different sign-in against the same shapes, and is
still a manifest.

Because the API is Invidious', `dto.ts` describes that vocabulary rather than
yt-dlp's, and most of it would serve an Invidious instance unchanged.

## Brings

Videos. They appear on the Videos tab, never in your library.

## Connection

- **Server URL** — required
- **Username** — required, marked as a credential, so it stays with the
  password when a connection keeps sign-ins per profile
- **Password** — required

Basic auth is stateless, so this adapter keeps **no session**. It reads the
credential store once per connected provider and builds one header.

## Settings

- **Stream through the server** — `relay` (the default) or `off`. Relay keeps
  the site from seeing the device and supports seeking; off sends the player
  straight to the site.
- **Trending from** — the region for the trending list.
- **Keep metadata on this device** — gates `media.offlineMetadata`.

## What it can do

`browse`, `search`, `playback`, `remoteImages`, `offlineMetadata`.

- **`check()`** asks `/health`, which is open before setup, and then `/info`,
  which is not — so one press proves both the address and the sign-in.
- **`listItems`** answers `/api/v1/trending` with no term and `/api/v1/search`
  with one. Trending is a single page the server curates. Search pages while a
  page comes back full, because the server says nothing about how many there
  are. The sort is mapped to the server's nearest order; pages come in the
  server's own.
- **`getItem` and `getChildren`** also open a channel (`channel:<id>`) or a
  playlist (`playlist:<id>`), each as a `show` with videos inside it.
- **`resolveImage`** builds `/api/v1/thumbnails/<id>/<name>.jpg` and
  `/api/v1/channels/<id>/avatar/<size>.jpg` from the size asked for, and both
  carry a `headersRef` the host resolves to the Basic header at load time —
  never an inline header.

## Decisions worth knowing

**A video is a `movie`.** `MediaItemType` has no `video`: it says what shape an
item is, and a video is one playable thing with a page of its own, as against
the show/season/episode hierarchy. The app knows it asked for `videos`, because
the query carries the kind.

**Playback uses `formatStreams` only.** `adaptiveFormats` keeps video and audio
apart, which needs a manifest no engine here is handed, so offering a 1080p
video-only rendition would be claiming something that cannot play. That caps
playback at whatever the site muxes — usually 720p. The server's own muxing
proxy (`/proxy/fast/{id}?format=…`) is the full-quality route, and is what
downloads will use.

**A stream address is a secret.** `/proxy/relay` URLs carry an HMAC signature
and an expiry, and `/proxy/fast/` a token. A descriptor is in memory only,
never logged, never cached — the rule this adapter inherits rather than
invents.

## Status

Implemented and tested against a fake of the server's routes
(`adapters/test/yattee.test.ts`, 24 cases). **Not yet run against a real
instance** — when it is, the two things to confirm are that Basic auth alone
reaches `/api/v1/thumbnails/` and `/api/v1/captions/` (this adapter does not
use their signing tokens), and what `/api/v1/channels/{id}/videos` returns for
`continuation`, which has nowhere to live until `getChildren` carries a cursor.

See `adapters/docs/writing-a-plugin/`.
