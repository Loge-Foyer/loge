# Playback

How the app plays what a source offers: descriptors and players, choosing an
engine, where each player is switched on, and how watch status gets back to the
source that masters it.

Jellyfin plays on the built-in player, on phones and in a browser; Stalker
comes later in Phase 7, and Phase 8 brings KSPlayer, mpv and VLC. This page is
the design they build to, and says where today differs.

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
| `players/system` | expo-video: AVPlayer on iOS, Media3 / ExoPlayer on Android; `<video>` with hls.js on the web | all | Phase 7 — the engine is in |
| `players/ksplayer` | KSPlayer | iOS | Phase 8 |
| `players/mpv` | MPVKit on iOS, libmpv on Android | iOS, Android | Phase 8 |
| `players/vlc` | VLCKit on iOS, libVLC on Android | iOS, Android | Phase 8 |

On the web there is only the built-in player; Phase 8 adds mpegts.js to it for
MPEG-TS live streams.

**Which players are on, and which plays first, are device settings**
(`DeviceSettings.players: { off, preferred }`, `services/players.ts`): never
journaled, never on your server, never in a backup. With none chosen, the
first one on plays first, in the catalogue's order — never by name.
`choosePlayer` takes these as they stand.

**Only the composition root imports a player** — its package, its view, and
`@sc/player-kit` (lint). The player screen gets the chosen player's controller
and view from the service graph, through `useServices()`. The app never
imports an engine itself — expo-video, hls.js, each Expo module belong to
their player plugin, and lint says so — but it installs them: they are the
player's peers.

**Players are native code.** expo-video is a published package, so the app
installs it and autolinking builds it from the app's `node_modules`. Phase 7's
spike proved the rest on Android: the built-in player's view, from the linked
package, drew HLS, live HLS, raw MPEG-TS and MP4, with one copy of React and
of expo-video in the bundle (`docs/plugins`). An Expo module in a player's own
package — KSPlayer, mpv, VLC — has not been tried, so Phase 8 opens with that
spike. A new or changed player means building again.

**What the built-in player tells.** A state is told once, and a new listener
hears the current one at once. On a phone, "playing" follows what was asked
for, not the engine's flag — Media3 is not playing while it buffers, and a
stream turns ready before it starts — so a screen never flashes a pause. A
track is named by its place (`audio-0`, `subtitle-1`): iOS gives expo-video's
tracks no id. Every failure is a `failed` state and an `AppError` both.

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
tables for it (`docs/data`), and `services/watch/` works them:

- **`watch_status`** — per profile, keyed `(user_id, connection_id,
  external_id)`: this device's state for the items it played or marked, and
  the item as last seen where its metadata may be kept.
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
  outbox in one transaction (`WatchService.report`, `setPlayed`). Airplane
  mode works. A source without `watchStateWrite` in effect is told nothing,
  and nothing is queued. A stop past 90% counts as watched here too, until
  the source says otherwise.
- **Until the source has heard, this device's state is shown:** rows, grids,
  seasons and detail pages get it laid over what the source answered,
  wherever something for the item still waits in the outbox. Once nothing
  does, the source wins again.
- **The drainer** (`services/watch/drainer.ts`) delivers the outbox oldest
  first, one lane per profile and connection, reading the outbox afresh before
  each report so a replaced one is never sent. It follows the retry hints:
  `backoff` tries again later, doubling from 30 s to 30 min;
  `network-change` parks the source until the network changes; a refused
  sign-in parks it until the user acts — pull to refresh — never a loop
  against a server that locks accounts. A report about an item the source no
  longer has, or one it refuses for good, is dropped. It runs at launch, a
  moment after something is queued, on a new network, on coming to the
  foreground, and when a retry is due.
- **Continue Watching** is the sources' resume lists with this device's state
  laid over them — an item marked watched here leaves it — plus what was
  watched here that a source has not heard of yet, most recent first.
- **Screens hear of a stop or a watched state** (`WatchService.subscribe`):
  Continue Watching, the item and its season refetch; rows and grids only go
  stale. Progress along the way is not news.

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

`(app)/play/[connectionId]/[itemId]` (`screens/player.tsx`) is full screen,
over the tabs, with `start` in milliseconds for a resume:

- **Pressing Play** is `PlaybackService.plan`: the device's players that can
  play here (`players.choosing()` — on, with a profile for this platform, in
  the catalogue's order), the source asked for a stream fit for the one that
  plays first, and `choosePlayer` over the answer. Where no player can, the
  screen says which kind would ("This needs a player that plays MPEG-TS."),
  with a way to Settings → Plugins → Players.
- **The chosen player's own view** draws underneath; the app's controls sit on
  top, the same for every engine: play and pause, ten seconds back and
  forward, a scrubber, the audio and subtitle tracks the stream carries, Next
  episode, and close. They step aside three and a half seconds after a touch
  while it plays, and come back at a tap or whenever it stops.
- **The controller is made in the screen's effect, never kept across one**
  (`hooks/use-playback.ts`): Fast Refresh and React's strict mode run effects
  twice, and a controller disposed in one run and reused in the next hands
  the native view a player that is gone — expo-video says "cannot be cast to
  VideoPlayer". It reaches the screen through its own first event, belongs to
  its plan, and is released a moment after the view has let go of it.
- **Reports** (`services/playback-reports.ts`): a start when it first plays,
  progress every ten seconds and on each pause, a stop at the end or wherever
  the player closed — each made when it happens and written in turn through
  `WatchService`, which tells only a source that keeps watch state. Live
  streams report nothing.
- **Upright everywhere else.** The app allows every orientation natively and
  locks upright at launch (iOS starts upright through expo-screen-orientation's
  `initialOrientation`); the player screen turns with the device, and upright
  comes back when it closes. A browser turns with its window.
- **A channel** opens the same screen with `live=1`, its name and its group:
  no item to read and nothing reported, no scrubber and no skipping, but LIVE,
  what is on now and next, and channel up and down through the group it was
  opened from. A channel whose only stream is raw MPEG-TS says, in a browser or
  on an iPhone, which player would play it.

Detail pages get Play — or Resume where the source says it stopped, with
From the beginning — for a film or an episode whose source has `playback` in
effect, and Mark watched or unwatched where it has `watchStateWrite`.

## Until an engine exists

The correct placeholder is a null engine that fails loudly, with a typed error
that says playback is not available. A silent no-op turns "playback not
implemented" into a mystery bug. Events and errors are logged under the
`player` category, with URLs redacted.
