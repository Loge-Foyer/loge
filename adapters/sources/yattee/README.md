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

`browse`, `search`, `feed`, `playback`, `remoteImages`, `offlineMetadata`,
`downloads` and `downloadOptions` — and `searchScopes`: all, video, channel,
playlist.

- **`check()`** asks `/health`, which is open before setup, and then `/info`,
  which is not — so one press proves both the address and the sign-in.
- **`listItems`** answers `/api/v1/trending` with no term and `/api/v1/search`
  with one, its `type` the query's scope — `video` when none is asked. A mixed
  answer is mapped item by item, as what each says it is. Trending is a
  single page the server curates. Search pages while a page brings something
  it has not answered yet: the server says nothing about how many pages there
  are, and its page is its own size whatever `limit` asks. The sort is mapped
  to the server's nearest order; pages come in the server's own.
- **`listFeed`** takes the channels the app holds as their keys —
  `channel:<id>`, as this adapter made them — and posts their ids to
  `/api/v1/feed`, each once, with the page as an offset; what is no channel is
  left out, and nothing at all asks nothing. The server keeps no list of its
  own.
- **`getItem` and `getChildren`** also open a channel (`channel:<id>`) — its
  face, banner and followers, and its sections: videos, shorts, live streams
  and playlists, each paged by the server's `continuation` — or a playlist
  (`playlist:<id>`), whose videos come in one answer. A video's detail names
  its channel (`creator`).
- **`resolveImage`** draws a picture from the address the server gave for it
  — the smallest at least as wide as asked. A server that proxies pictures
  hands out its own `/api/v1/thumbnails/<id>/<file>?token=…`: its Basic
  sign-in middleware leaves that path alone, and the endpoint checks only the
  token, which it signs for that video and a day. One that does not proxy
  hands out the site's CDN. Only the server's own address carries the
  `headersRef` the host resolves to the Basic header; another host never sees
  it.
  - **The addresses live in memory**, from each answer. A ref names the video,
    the channel's face or banner, or a playlist (`v/<id>`, `c/<id>`, `b/<id>`,
    `p/<id>`) and nothing that expires, because saved
    lists and kept copies hold refs for longer than a day. A picture no answer
    has named yet draws its plate until one does, and the host draws again
    when the source answers.

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
(`adapters/test/yattee.test.ts`). **Run against a real instance**, where it
listed videos and their pictures came out blank: Basic auth alone does not
reach `/api/v1/thumbnails/` or `/api/v1/captions/` — the server's
`basic_auth.py` leaves both paths to the endpoints, which want the token
signed into the addresses the server hands out. Pictures use those addresses
now (above); that is tested against the fake, and not yet seen on the real
server. Captions already took the server's addresses as given.


See `adapters/docs/writing-a-plugin/`.
