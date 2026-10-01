# VLC

VLC's engine, libVLC, for nearly anything: Matroska, DTS and TrueHD, AV1, raw
MPEG-TS, the subtitles inside a file. On Android and on iPhone, one engine
behind both; there is no VLC for the web.

## Category

**Player** — `players/vlc`. Device-wide: each device switches it on or off,
and may make it the default.

## What it plays

Its profile (`src/profiles.ts`) says what, and a source that transcodes, such
as Jellyfin, shapes its answer to it. libVLC decodes in hardware where the
device can and in software where it cannot, so the lists are the formats' own:

| | Protocols | Files | Video | Audio | Subtitles |
| --- | --- | --- | --- | --- | --- |
| Android — libVLC 3 | HLS, DASH, MPEG-TS, progressive | MP4, MKV, WebM, AVI, TS, M2TS, FLV, WMV, MPEG, VOB… | H.264, HEVC, VP8, VP9, AV1, MPEG-2, MPEG-4, VC-1 | AAC, MP3, AC-3, E-AC-3, DTS, TrueHD, Opus, Vorbis, FLAC, ALAC, PCM… | SRT, ASS, WebVTT, PGS, DVD, DVB |
| iPhone — libVLC 3 | the same | the same | the same | the same | the same |

One engine, so one list twice: MobileVLCKit is the same libVLC generation as
Android's `libvlc-all`, and VideoToolbox and MediaCodec only decide how much
of it decodes in hardware — how warm the phone gets, not what plays.

HDR is left out: whether it shows right depends on the screen and the
decoder, and a server that transcodes tone-maps it.

## How it works

One Expo module, `ScVlc`, with a half per platform. Both are autolinked into
the app's development build from this package, and both expose the same
module name, the same `Player` class and the same view — so everything in
`src/` is shared, unchanged, between them.

- **`android/`** — Kotlin. libVLC comes from Maven Central
  (`org.videolan.android:libvlc-all`).
  - `ScVlcPlayer` is a shared object: one `LibVLC` and one `MediaPlayer` per
    controller, reached on the main thread, where libVLC sends its events
    too. It holds the stream's address in memory, to open it again, and lets
    everything go when JavaScript releases it.
  - `ScVlcView` is the view libVLC draws into — its own `VLCVideoLayout`,
    attached while the view is on screen.
- **`ios/`** — Swift, against MobileVLCKit from CocoaPods, which ships as a
  vendored xcframework fetched from VideoLAN at install time. The same three
  types, and three differences VLCKit forces:
  - Tracks come as two parallel arrays rather than descriptors, so they are
    zipped and libVLC's own "Disable" at -1 dropped.
  - There is no length event and no buffering percentage — VLCKit 3 discards
    the latter — so the length is read inside the time callback and "playing"
    is not gated on a full buffer.
  - A sync `Function` runs on the JS thread and only `AsyncFunction` takes a
    queue, so each command hops to the main thread itself. So does the
    delegate, which VLCKit calls on libVLC's own event thread — reading a
    track list from there would re-enter libVLC under its own lock. The
    delegate is an Objective-C protocol, so a small `NSObject` forwards to the
    player, which is a `SharedObject` and cannot be one.
  - `ScVlcView` also sets an audio session category, which Android needs no
    equivalent for: without it the ringer switch silences playback.
- **`src/native.ts`** — the module as JavaScript sees it, reached lazily: the
  package is imported everywhere, and the module exists only in a native
  build.
- **`src/engine.ts`** — the `MediaPlayer`. libVLC opens a stream when it is
  first played, from the start position the load asked for. After the end it
  plays a stream again only by opening it anew, which the next play does.
- **`src/view.tsx`** — the `PlayerView`: the native view, handed the
  controller's libVLC player. Given another player's controller, it throws.

What it tells, as `PlayerEvent`s, through `@sc/api`'s `createPlayerEvents`:

- **A state once.** "Loading" until the first frame — libVLC's buffering, done
  before it plays, reads as paused, and is not — then libVLC's own.
- **The position once a second,** with the length unless the stream is live.
- **Tracks by libVLC's ids** — `audio-1`, `subtitle-3` — with the names it
  makes up ("Track 1 - [English]"); once per change.
- **A failure as a `failed` state and an `AppError`,** worth trying again. A
  stream that needs a header other than a user agent or a referrer is refused
  loudly: libVLC cannot send one.

## Dependencies

`@sc/api`, `@sc/player-kit`, React, React Native and `expo`, all peers: the
app installs them. The modules API is reached through `expo`, never
`expo-modules-core` directly — autolinking would otherwise follow the peer
into this repository's `node_modules` and build a second copy under the app's
JavaScript. The tests alias `expo` to a fake
(`test/support/fake-expo.ts`, wired in `vitest.config.ts`).

## Licence

libVLC is LGPL 2.1 or later, linked dynamically, unchanged, on both
platforms: Android's shared libraries and iOS's `MobileVLCKit.xcframework`
ship inside the app as they come from VideoLAN. Being LGPL, it puts no
licence of its own on the app.

## Platforms

iOS and Android. There is no VLC for the web, so the manifest does not say
`web` and its profile map has no entry for it.

## Status

The player role on both phones, tested against a fake of its module. Android
has been played on the emulator: raw MPEG-TS, Matroska with E-AC-3 as the
file, its subtitles. The iOS half compiles and links; it has not played yet.
