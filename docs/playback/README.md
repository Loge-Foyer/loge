# Playback

How the app plays what a source offers: descriptors and players, choosing an
engine, where each player is switched on, and how watch status gets back to the
source that masters it.

Nothing plays yet. Phase 7 brings the built-in player, with Jellyfin and
Stalker playing on it; Phase 8 brings KSPlayer, mpv and VLC. This page is the
design they build to.

## What to play, and how to play it

Two contracts, kept apart so the app never learns which engine it is talking
to:

- **What to play** is a `PlaybackDescriptor`, from `@sc/api`. A source returns
  one from `getPlaybackDescriptor`, which it has when it declares the
  `playback` capability. It lists:
  - the ways to reach the stream, best first — each a `PlaybackSource` with its
    URI, a `headersRef`, its protocol (`progressive`, `hls`, `dash`,
    `mpegts`), container and codecs, and whether it is a transcode or live
  - the audio and subtitle tracks, each subtitle with its format and how it is
    delivered: `embedded`, `external` or `burned` in
  - where to start: the resume position, when there is one
- **How to play it** is a player plugin: an engine behind `MediaPlayer` and
  `PlayerEvent`. The app loads a source, plays, pauses, seeks, chooses tracks
  and listens; the engine does the rest.

## Players are plugins

A player plugin is in the `players` category, and has three parts:

- **A manifest block** (`player`) — what its engine plays on each platform, as
  a `PlayerProfile`: protocols, containers, video and audio codecs, subtitle
  formats, HDR, the largest picture.
- **A controller**, `MediaPlayer`, defined in `@sc/api` and free of any
  framework: `load`, `play`, `pause`, `seek`, `setAudioTrack`,
  `setSubtitleTrack`, `subscribe`, `dispose`. Its events say the state, the
  position, the tracks, or an error — always an `AppError`, never a raw one.
- **A view**, `PlayerView`, defined in `@sc/player-kit`, which draws the
  engine's pixels. `@sc/api` imports nothing, so React lives there.

| Plugin | Engine | Platforms | Arrives |
| --- | --- | --- | --- |
| `players/system` | expo-video: AVPlayer on iOS, Media3 / ExoPlayer on Android; `<video>` with hls.js on the web | all | Phase 7 |
| `players/ksplayer` | KSPlayer | iOS | Phase 8 |
| `players/mpv` | MPVKit on iOS, libmpv on Android | iOS, Android | Phase 8 |
| `players/vlc` | VLCKit on iOS, libVLC on Android | iOS, Android | Phase 8 |

On the web there is only the built-in player; Phase 8 adds mpegts.js to it for
MPEG-TS live streams.

**Only the composition root imports a player** — its package, its view, and
`@sc/player-kit` (a lint rule, added with them in Phase 6 or 7). The player screen gets the
chosen player's controller and view from the service graph, through
`useServices()`. The app never imports an engine itself: expo-video, and each
Expo module, belong to their player plugin.

**Players are native code.** A player plugin's engine — expo-video, or an Expo
module in the plugin's own package — has to reach the development build by
autolinking from a `file:`-linked package. That is unproven, so Phases 7 and 8
each open with a spike. A new or changed player means building again.

## Players are device-wide

Which players are on, which is the default, and each player's settings belong
to the device. They are device settings: never journaled, never on your
server, never in a backup. A phone and a browser on the same account choose
their players apart.

Settings → Plugins → Players lists this platform's players, each with its
switch and settings, and the default. Phase 8 adds an override per tab —
Media, Videos, TV — and "Play with…" on an item.

## Choosing a player

`choosePlayer(sources, candidates, preferred?)` in `@sc/api` decides, and it is
pure:

1. The device's default, when it can play one of the item's sources.
2. Otherwise the first enabled player on this platform that can, in the order
   the app ranks them.
3. Otherwise none. `missingFor` says what was lacking — the protocol, the
   container, a codec, the picture size — and the app words it: "This channel
   needs a player that plays MPEG-TS."

The candidates are the enabled players whose manifest runs here, each with its
profile for this platform. Nothing in the choice names an engine.

A source that transcodes, such as Jellyfin, is asked with the profile of the
player the app means to use, in its `PlaybackRequest`. It answers with what
that engine plays: direct play when it can, otherwise a direct stream or a
transcode. A source that does not transcode answers as it is, and the choice
is made on what it offers.

## Descriptors live in memory only

A stream URL can carry credentials. Xtream puts the password in the path, a
Stalker link holds a session token, and on the web Jellyfin's token rides in
the URL as `api_key`, because a `<video>` element cannot send headers. So a
descriptor:

- is never persisted — not in the database, not in the media cache, not in a
  backup
- is never logged; redaction covers URLs and MAC addresses
- is asked for again when an item is played again

`headersRef` is an opaque handle on the secure store. The engine resolves it at
load time (`PlayerContext.resolveHeaders`), and holds what it gets in memory;
it is never inlined, logged or persisted. A Stalker link is made with
`create_link` when the channel is played, and forgotten with it.

## Watch status has one master

An item from a source that keeps watch status (`watchStateRead`,
`watchStateWrite`) is mastered by that source: Jellyfin knows what was watched,
and the app never masters the same thing a second time. Migration v5 adds two
tables for it (Phase 7):

- **`watch_status`** — a cache per profile, keyed `(user_id, connection_id,
  external_id)`, filled from the source.
- **`outbox`** — what this device has to tell the source.

```
read     source → cache
write    cache + outbox entry (one transaction) → return
                       ↓
         outbox drained to the source (watchStateWrite)
refresh  the source wins, except over entries still in the outbox
```

- **Writes are local-first**, like every other write: marking something
  watched, or the position when playback stops, lands in the cache and the
  outbox in one transaction. Airplane mode works.
- **The drainer** delivers each entry to the source, every report idempotent,
  following retry hints: `backoff` tries again later, `network-change` waits for a new
  network, and a refused sign-in parks the source until the user acts — never
  a loop against a server that locks accounts.
- **Continue Watching** reads the cache, merged with the source's own resume
  list.

Sources that cannot keep watch status — files, web video, IPTV movies and
series — get app-owned watch state on the account later. It will be resolved
field-aware — completed first, then the furthest position — so a device that
reports position 0 a second after stopping never erases real progress.

## Reporting progress

Playing reports back through the outbox, never straight from the player to the
source, as `PlaybackReport`s:

- `started`, when playback begins
- `progress`, with the position and whether it is paused — every ten seconds,
  and on pause and seek
- `stopped`, with the final position
- `played`, when an item is marked watched or unwatched

The source's plugin maps each report to its server's own calls. The app never
names them.

## The player screen

`(app)/play/[connectionId]/[itemId]` (Phase 7) is full screen, over the tabs:

- scrubbing, the audio and subtitle pickers, and the next episode
- for live TV, channel up and down, and what is on now and next

Detail pages get Play, Resume, Mark watched or unwatched, and Next episode
with it.

## Until an engine exists

The correct placeholder is a null engine that fails loudly, with a typed error
that says playback is not available. A silent no-op turns "playback not
implemented" into a mystery bug. Events and errors are logged under the
`player` category, with URLs redacted.
