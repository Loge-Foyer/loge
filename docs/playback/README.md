# Playback

How the app plays what a source offers: descriptors and players, choosing an
engine, where each player is switched on, and how watch status gets back to the
source that masters it.

Jellyfin and Stalker play on the built-in player, on phones and in a browser,
and on mpv. This page is the design they build to, and says where today
differs.

## What to play, and how to play it

Two contracts, kept apart so the app never learns which engine it is talking
to:

- **What to play** is a `PlaybackDescriptor`, from `@loge/api`. A source returns
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

## Keeping a copy

A download is the same question as playback asked differently: not "what can
this engine open right now" but "what one file, small enough to be worth the
space, will any engine on this device still open in a month".

- **Two capabilities.** `downloads` means a source will hand over a copy;
  `downloadOptions` means there is a choice of versions — because the server
  will make one (Jellyfin transcoding) or because several already exist (a
  site's own renditions). A source with the first alone hands over what it
  has, and no sheet of choices is shown.
- **What to ask for** is Settings → Downloads → Options: a smaller copy or
  the file as it is, a resolution, a bitrate, HDR. This device's, for every
  source at once. **It does not drive a download yet**: the detail page lists
  the versions a source offers, and the queue asks for the one chosen, never
  passing `DownloadRequest.quality`. Wiring it — the version that fits taken
  in one tap — is for later.
- **A `DownloadDescriptor` is as secret as a `PlaybackDescriptor`**: its
  address can hold an `api_key`, an HMAC signature or a session token. Memory
  only, never a row, never a log.
- **One file, never a playlist.** Jellyfin's download profile says `http` and
  `Static`; HLS would be a manifest and a folder of segments, which is not
  something to keep.
- **A copy plays before the source is asked.** `PlaybackService.plan` looks in
  the downloads first and synthesises a `file://` progressive source — which
  every engine opens, and which needs no network at all. Only a finished one:
  a half-written file is not something to hand a player. It starts where it
  was asked to — Resume's position, or the beginning — as a stream would,
  never where it stood when it was kept.
- **Its page opens offline too.** When neither the source nor a saved page
  answers, the detail page is drawn from the item as it was kept — gone from
  the source or not, the file is still on this device.
- **On-device conversion is not built**, and the switch says why: a phone
  would still pull the whole film down to shrink it, so only disk is saved and
  not bandwidth, and on iPhone AVFoundation cannot read Matroska — which is
  what most large films are. Asking the server costs nothing and sends less.

## Players are plugins

A player plugin is in the `players` category, and has three parts:

- **A manifest block** (`player`) — what its engine plays on each platform, as
  a `PlayerProfile`: protocols, containers, video and audio codecs, subtitle
  formats, HDR, the largest picture.
- **A controller**, `MediaPlayer`, defined in `@loge/api` and free of any
  framework: `load`, `play`, `pause`, `seek`, `setAudioTrack`,
  `setSubtitleTrack`, `subscribe`, `dispose`. Its events say the state, the
  position, the tracks, or an error — always an `AppError`, never a raw one.
- **A view**, `PlayerView`, defined in `@loge/player-kit`, which draws the
  engine's pixels. `@loge/api` imports nothing, so React lives there.

| Plugin | Engine | Platforms | Arrives |
| --- | --- | --- | --- |
| `players/system` | expo-video: AVPlayer on iOS, Media3 / ExoPlayer on Android; `<video>` with hls.js and mpegts.js on the web | all | Phase 7; MPEG-TS on the web in Phase 8 |
| `players/mpv` | libmpv on Android, through an Expo module in its adapter with its own JNI; MPVKit on iOS | Android, iOS | Phase 8 — Android is in; iOS built, not yet played |
| `players/vlc` | libVLC 3.7 on Android; VLCKit 3.7 on iOS — MobileVLCKit on iPhone, TVVLCKit on Apple TV | Android, iOS | Phase 8, dropped in Phase 9, back since |

**VLC left in Phase 9 and came back**, both halves, and Apple TV with them. On
iPhone libVLC 3 draws into a plain OpenGL view, so the system has no layer to
take over for picture in picture: VLC's profile does not claim it, and mpv and
the built-in player keep theirs. VLCKit 4 would give it one, and is still an
alpha. **KSPlayer never arrived**: it is on no package manager, its own podspec
pins a tag that does not exist, and its FFmpeg ships only as a very large git
clone — its adapter is a manifest, and is not registered.

On the web there is only the built-in player. It plays raw MPEG-TS through
mpegts.js, fetched as a chunk of its own the first time a stream needs it, as
hls.js is for HLS; CORS still applies.

**The controls are the app's, not a player's.** A player is the engine; the
buttons over it are the same whichever one is playing, and are arranged once
in Settings → Adapters → Players. Back, play and forward sit in the middle and
are not configurable — they *are* the player — but how far the two seek
(`app.seekMs`) and what sits in the row beneath (`app.buttons`) are the
device's. A button with nothing behind it is not drawn: no second audio track,
no subtitles, no chapters, or an engine with no rate to set. `setRate` is
optional on `MediaPlayer` for exactly that reason.

**The edges** are a phone's and a tablet's alone: a television's volume is
the television's, and a browser has a pointer, not a thumb at the side of the
screen. With the controls up, each edge of the picture shows its level —
brightness on one, volume on the other, as Settings → Adapters → Players
arranges them — on every tab, live or not, whichever engine plays.
- A drag up or down the outer third of the picture moves the level, and brings
  the controls up with it. A drag in the middle third, or a tap, is the
  controls'; so is a drag while a panel is open over the picture.
- **One responder for the player's whole life.** The screen hands it its
  latest state after each render. Made afresh on every render, it lost every
  drag: the grant itself renders, so each move reached a responder that had
  never granted it — always the left edge, and only the last step.
- **They keep to the safe area**, clear of a notch, a rounded corner or the
  home indicator, on whichever side the phone was turned; so do the controls.
  The player has a `SafeAreaProvider` of its own: a full-screen modal is
  measured apart from the screen beneath it, whose insets stay those of a
  phone held upright.
- **Volume is the device's own**, the one its buttons move: `modules/loge-volume`.
  - On iPhone it goes through MPVolumeView, which also keeps the system's own
    banner away while the player is open.
  - On Android it is the music stream.
- A double tap on a side flashes that side, faintly, as it jumps.

**Picture in picture is armed only while something plays.** The system
starts it by itself as the app is left, so a film paused, finished or closed
shrinks nothing.
- The built-in player's view follows the flag as it changes
  (`watchPictureInPicture`).
- mpv lets go of its controller when it is released.
- Android's auto-enter is set and cleared with it.

**Chapters and segments ride on the descriptor.** `PlaybackDescriptor.chapters`
marks the scrubber; `PlaybackDescriptor.segments` says which stretches are an
intro, outro, recap, preview or advert. Inside one the player offers a single
button — skip to its end, or, in an outro, the next episode. Neither is gated
by a capability: a source that has none sends none. Jellyfin reads them from
`fields=Chapters` and `/MediaSegments/{id}`, best-effort, so a server without
either still plays.

**Which players are on, and which plays first, are device settings**
(`DeviceSettings.players: { off, preferred, order, tabs }`,
`services/players.ts`): never journaled, never on your server, never in a
backup. A device that has chosen nothing starts on the composition root's
`playerDefaults` — the one place that may name players: mpv first, and first
on Media; VLC next, and first on TV, where the raw MPEG-TS channels are; the
built-in player on, and first nowhere. A stored order or set of firsts wins
over them, and taking one tab never drops another's default. In a browser
neither mpv nor VLC is here, so the built-in player plays everything.
`choosePlayer` takes these as they stand.

**Only the composition root imports a player** — its package, its view, and
`@loge/player-kit` (lint). The player screen gets the chosen player's controller
and view from the service graph, through `useServices()`. The app never
imports an engine itself — expo-video, hls.js, each Expo module belong to
their player plugin, and lint says so — but it installs them: they are the
player's peers.

**Players are native code.** expo-video is a published package, so the app
installs it and autolinking builds it from the app's `node_modules`. An Expo
module in a player's own adapter — mpv's — is autolinked from `adapters/`,
which is a workspace of this app, so every package it depends on is the one
copy in `node_modules`. On the Android emulator mpv played the mock portal's
raw MPEG-TS and a Jellyfin film in Matroska with E-AC-3 as the file itself,
from where it was left, with the file's own subtitles, turning with the
device. A new or changed player means building again.

**One libc++_shared.so, and the newest.** React Native and libmpv each carry
one, and an APK holds a single copy: the first the merge sees,
which is React Native's, and which libmpv cannot load. A source set of the
app's own wins the merge outright, so
`config-plugins/with-newest-libcxx.js` points one at what mpv's module
unpacks. Packaging is the app's: a player plugin cannot know what a second
plugin's engine put in the same APK. libmpv also needs Android 8, which is
why `expo-build-properties` sets `minSdkVersion` to 26.

**What a player tells.** A state is told once, and a new listener hears the
current one at once — `createPlayerEvents` in `@loge/api` keeps that promise for
every engine — and every failure is a `failed` state and an `AppError` both.
On a phone the built-in player's "playing" follows what was asked for, not the
engine's flag — Media3 is not playing while it buffers, and a stream turns
ready before it starts — so a screen never flashes a pause; it names a track by
its place (`audio-0`, `subtitle-1`), because iOS gives expo-video's tracks no
id. mpv names them as the file does,
with each track's language and codec, and says so out loud when a decoder
takes a stream and hands back no frame.

## Players are device-wide

Which players are on, which is the default, and each player's settings belong
to the device. They are device settings: never journaled, never on your
server, never in a backup. A phone and a browser on the same account choose
their players apart.

Settings → Adapters → Players lists this platform's players, each with its
switch and settings, and which plays first. A player's page also makes it
first on a tab — Media, Videos, TV — which goes before the device's choice
there (`DeviceSettings.players.tabs`). Channels, and everything an IPTV
provider brings, play from TV (`tabOfPlaying` in `services/tab-content.ts`).
Videos does not choose yet: `tabOfPlaying` counts a source's items as Media's,
so "first on Videos" is kept, and shown, but plays nothing first.
A player with no engine on this platform says so, and never plays.

**"Play with…"** on a detail page lists the players that are on and can play
here, when there is more than one. The one picked is asked for by the source
with its own profile, and plays or nothing does — never another in its place.
The next episode keeps it.

## Choosing a player

`choosePlayer(sources, candidates, preferred?)` in `@loge/api` decides, and it is
pure:

1. The one first on the item's tab, else the device's default, when it can
   play one of the item's sources.
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

**Sources that keep no watch status** — IPTV films and series, web video,
plain files — have it kept by the app, on the account, where Settings →
Watch status keeps it for the tab they show on (Media off by default, Videos
and TV on). `Source.watch` says who keeps it — the source, the app, or nobody
— and is the only thing screens ask: a badge, Resume and the eye follow it.

- **Written here, journaled, carried to your server** — no outbox: nothing
  waits on the source, which keeps nothing (`WatchService.report`,
  `setPlayed`). A stop at 90 % of the engine's own length is watched; a
  report at nought never lowers where it got to.
- **One row per thing watched, not per copy.** A provider that keeps a film's
  German and English copies apart — and its HQ and 4K ones — matches them to
  one TMDB id, and watching one marks them all (`watchIdentity`).
- **Where the provider says nothing, a metadata adapter does.** With a TMDB
  connection on, the items drawn with their kept status are looked up in the
  background (`IdentityService.resolve`, from `useKeptWatch`): an IPTV film or
  series known only by its title — an episode by its series' — four at a
  time, each answer remembered on the device (v10), a miss for thirty days.
  What was kept under the title moves to the TMDB id, journaled, so every
  device follows. A refused key stops the lookups until it changes; a
  refusal for load, or no network, pauses them for a minute. Writing never
  waits on TMDB: a mark uses whatever this device already knows.
- **Laid over lists where they are drawn** (`useKeptWatch`): local state, so a
  mark shows at once and no source is asked again. The TV tab lists what was
  begun first (`keptInProgress`).
- **Resolved field by field** (spec §10): a later round wins whole; within one,
  watched holds and the position is the last push's — a deliberate rewind on
  one device reaches the others, which "the furthest position" would undo.

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
  with a way to Settings → Adapters → Players.
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
From the beginning beside it — for a film or an episode whose source has
`playback` in effect, and the eye, to mark it watched or unwatched, where it
has `watchStateWrite`. "Play with…" is in the page's "⋯" menu, beside
Download and Add to list.

## Until an engine exists

The correct placeholder is a null engine that fails loudly, with a typed error
that says playback is not available. A silent no-op turns "playback not
implemented" into a mystery bug. Events and errors are logged under the
`player` category, with URLs redacted.
