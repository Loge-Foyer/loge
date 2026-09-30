# VLC

VLC's engine, libVLC, for nearly anything: Matroska, DTS and TrueHD, AV1, raw
MPEG-TS, the subtitles inside a file. Android for now; VLCKit on iPhone and
iPad comes later.

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

HDR is left out: whether it shows right depends on the screen and the
decoder, and a server that transcodes tone-maps it.

## How it works

- **`android/`** — an Expo module, `ScVlc`, autolinked into the app's
  development build from this folder. libVLC comes from Maven Central
  (`org.videolan.android:libvlc-all`).
  - `ScVlcPlayer` is a shared object: one `LibVLC` and one `MediaPlayer` per
    controller, reached on the main thread, where libVLC sends its events
    too. It holds the stream's address in memory, to open it again, and lets
    everything go when JavaScript releases it.
  - `ScVlcView` is the view libVLC draws into — its own `VLCVideoLayout`,
    attached while the view is on screen.
- **`src/native.ts`** — the module as JavaScript sees it, reached lazily: the
  package is imported everywhere, and the module exists only in an Android
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

`@sc/api`, `@sc/player-kit`, React, React Native and `expo-modules-core`, all
peers: the app installs them. The tests alias `expo-modules-core` to a fake
(`test/support/fake-expo-modules-core.ts`).

## Licence

libVLC is LGPL 2.1 or later, linked dynamically, unchanged: its shared
libraries ship inside the app as they come from VideoLAN.

## Platforms

Android. VLCKit on iOS is planned; there is no VLC for the web.

## Status

The player role on Android, tested against a fake of its module.
