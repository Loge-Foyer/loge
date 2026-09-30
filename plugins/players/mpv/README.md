# mpv

The mpv engine, for nearly any file: Matroska, HEVC, DTS, TrueHD, AV1, raw
MPEG-TS — with subtitles drawn the way the file styles them, and any header a
stream needs. Android for now; MPVKit on iPhone and iPad comes later.

## Category

**Player** — `players/mpv`. Device-wide: each device switches it on or off,
and may make it the default, or the one that plays first on a tab.

## What it plays

Its profile (`src/profiles.ts`) says what, and a source that transcodes, such
as Jellyfin, shapes its answer to it. FFmpeg's own decoders do the work, so
the lists are the formats' own:

| | Protocols | Files | Video | Audio | Subtitles |
| --- | --- | --- | --- | --- | --- |
| Android — mpv 0.41 | HLS, DASH, MPEG-TS, progressive | MP4, MKV, WebM, AVI, TS, M2TS, FLV, WMV, MPEG, VOB… | H.264, HEVC, VP8, VP9, AV1, MPEG-2, MPEG-4, VC-1 | AAC, MP3, AC-3, E-AC-3, DTS, TrueHD, Opus, Vorbis, FLAC, ALAC, PCM… | SRT, ASS, WebVTT, PGS, DVD, DVB |

**It stops at 1080p**, because it decodes in software (below). HDR is left
out: how it looks depends on the screen, and a server that transcodes
tone-maps it.

What it has over the other players: **libass** draws SRT and ASS with the
file's own styling, its track lists carry each track's language and codec, and
it sends **any header** — a portal's cookie included, which libVLC cannot.

## How it works

- **`android/`** — an Expo module, `ScMpv`, autolinked into the app's
  development build from this folder. The engine comes from Maven Central
  (`dev.jdtech.mpv:libmpv`), and only its binaries are used.
  - **`src/main/cpp/sc-mpv.cpp`** is this package's own JNI, on libmpv's
    published C API. The engine's own Android wrapper is not used: it asks
    mpv for every log message and prints each one to the device log —
    including the address of the stream it opens, with a Jellyfin `api_key` or
    a portal's session token in it. No option turns that off, because
    `msg-level` sets the terminal's level while the level a client asked for is
    what mpv keeps generating for. This package asks for no log at all.
  - **`ScMpvPlayer`** is a shared object: one mpv core per controller. **Every
    call into mpv waits for its core**, which while a file opens is busy for
    seconds at a time, so they all go one after another on a thread of this
    player's own — never the app's main thread — and what mpv answers becomes
    an event on the main thread. The surface is the exception: Android hands
    it over and takes it back on the main thread, and mpv has to be done with
    it before that call returns.
  - **`ScMpvView`** holds the `SurfaceView` mpv draws into with OpenGL ES.
- **`src/native.ts`** — the module as JavaScript sees it, reached lazily: the
  package is imported everywhere, and the module exists only in an Android
  build.
- **`src/engine.ts`** — the `MediaPlayer`. Tracks keep mpv's own ids
  (`audio-2`, `subtitle-3`), which hold while the file is open. mpv starts a
  file where the load asked and holds the last frame at the end, so playing
  again is a seek.
- **`src/view.tsx`** — the `PlayerView`, which draws the controller's core and
  nothing else. The controls are the app's.

## Software decoding, for now

`hwdec` is `no`. Android's own decoder takes this project's emulator 1080p
streams and then hands mpv no frame at all — in `mediacodec-copy` and in
`mediacodec` alike, while 720p plays — so hardware decoding has never been
seen working here. FFmpeg's decoders play everything the profile claims, and
the profile stops at 1080p while they do the work.

A real phone is what settles it, and a switch for it belongs with the player's
own settings once a player plugin can read them.

## Two traps this package holds

- **The player's id, never the player, goes to the native view.** React
  Native's development renderer deep-freezes every prop a view mounts with,
  and a frozen shared object can no longer be released.
- **mpv stops answering if its video output goes while it is playing.** So the
  view pauses before it takes the surface back, and takes playback up again
  when one comes back — which is what turning the device does. Letting the
  player go does not touch the video output at all: the core goes, and the
  picture, the sound and the stream with it.

## Licence

The binaries are FFmpeg and mpv configured `--enable-gpl --enable-version3`,
which makes them **GPLv3** — and so is this app. Shipping a closed build would
need LGPL engines, built from source; that is a plan of its own at the
workspace root.

## Platforms

Android. iPhone and iPad wait for MPVKit.

## Status

The player role is implemented on Android and tested against a fake of its
Expo module. On the Android emulator it played a portal's raw MPEG-TS channel
and a Jellyfin film straight from the file — Matroska, H.264 with E-AC-3 —
resumed, with the file's own subtitles drawn by libass, turning with the
device, and nothing of the stream in the device log.

See `docs/writing-a-plugin/` at the repository root.
