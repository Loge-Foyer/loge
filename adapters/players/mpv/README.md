# mpv

The mpv engine, for nearly any file: Matroska, HEVC, DTS, TrueHD, AV1, raw
MPEG-TS — with subtitles drawn the way the file styles them, and any header a
stream needs. On Android and on iPhone, libmpv's own C API behind both.

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
| iPhone — mpv 0.41 | the same | the same | the same | the same | the same |

**The two differ only in how tall a picture they claim**, and for a reason
about the decoder rather than the engine: **Android stops at 1080p** because
it decodes in software (below), while on iPhone VideoToolbox does H.264 and
HEVC in hardware and mpv falls back to FFmpeg's own decoders for the rest, so
it claims 4K. HDR is left out on both: how it looks depends on the screen, and
a server that transcodes tone-maps it.

What it has over the other players: **libass** draws SRT and ASS with the
file's own styling, its track lists carry each track's language and codec, and
it sends **any header** — a portal's cookie included, which libVLC cannot.

## How it works

One Expo module, `LogeMpv`, with a half per platform, both autolinked into the
app's development build from this package. Both talk to **libmpv's own C API**
and neither ever calls `mpv_request_log_messages`, so mpv generates no log
message for anyone — and the address of a stream, with whatever token is in
it, cannot reach the device log. Everything in `src/` is shared between them.

- **`android/`** — Kotlin and this package's own JNI. The engine comes from
  Maven Central (`dev.jdtech.mpv:libmpv`), and only its binaries are used.
  - **`src/main/cpp/loge-mpv.cpp`** is this package's own JNI, on libmpv's
    published C API. The engine's own Android wrapper is not used: it asks
    mpv for every log message and prints each one to the device log —
    including the address of the stream it opens, with a Jellyfin `api_key` or
    a portal's session token in it. No option turns that off, because
    `msg-level` sets the terminal's level while the level a client asked for is
    what mpv keeps generating for. This package asks for no log at all.
  - **`LogeMpvPlayer`** is a shared object: one mpv core per controller. **Every
    call into mpv waits for its core**, which while a file opens is busy for
    seconds at a time, so they all go one after another on a thread of this
    player's own — never the app's main thread — and what mpv answers becomes
    an event on the main thread. The surface is the exception: Android hands
    it over and takes it back on the main thread, and mpv has to be done with
    it before that call returns.
  - **`LogeMpvView`** holds the `SurfaceView` mpv draws into with OpenGL ES.
- **`ios/`** — Swift, calling the same C entry points directly: no JNI and no
  wrapper, because `import MPVKit` exposes them. The engine comes from
  MPVKit's merged xcframework, asked for by the **app** through
  `ios.extraPods` in `app.json` — MPVKit is not usably on CocoaPods trunk and
  the installed autolinking reads podspecs only, so the app declares it and
  this package's podspec names it. Packaging is the app's, as
  `config-plugins/with-newest-libcxx.js` says for Android.
  - **The video output never comes and goes.** mpv draws into an
    `AVSampleBufferDisplayLayer` the player owns, handed over as `wid` before
    `mpv_initialize`, and `LogeMpvView` only puts that layer on screen. None of
    Android's attach, detach and pause-around-it applies.
  - `hwdec` is `videotoolbox`, with `hwdec-software-fallback`, and the
    subtitles are composited into the same layer as the picture.
- **`src/native.ts`** — the module as JavaScript sees it, reached lazily: the
  package is imported everywhere, and the module exists only in a native
  build.
- **`src/engine.ts`** — the `MediaPlayer`. Tracks keep mpv's own ids
  (`audio-2`, `subtitle-3`), which hold while the file is open. mpv starts a
  file where the load asked and holds the last frame at the end, so playing
  again is a seek.
- **`src/view.tsx`** — the `PlayerView`, which draws the controller's core and
  nothing else. The controls are the app's.

## Reading ahead

The device's Buffering (`PlayerPreferences.buffering`, decided per stream by
`bufferingFor`) reaches the native `load` as a cache spec, set before each
`loadfile` on both platforms:

- **Off** — `cache=no`: no further than playing needs.
- **Memory** — `cache=auto`, mpv's own cache, as before there was a choice.
- **Disk** — `cache=yes` and `cache-on-disk=yes`, with `demuxer-cache-dir` in
  the app's caches, for a film or an episode; a live stream or a file on the
  device reads ahead in memory instead. The profile says so
  (`buffersOnDisk`) on iOS and Android.
  - mpv's cache file only grows — it frees nothing in it until the file is
    closed — and `demuxer-max-bytes` applies to its index only. So once a
    second the player reads `file-cache-bytes` out of `demuxer-cache-state`
    (a node, read whole: the JNI's `cacheFileBytes`, `mpv_node` in Swift)
    and, at the limit, turns `cache-on-disk` off: no more is written to it,
    and mpv carries on in memory until the file closes with the player.
  - With less free than the limit and a gigabyte to spare, it reads ahead in
    memory from the start. The file is unlinked as soon as it is made
    (mpv's default), so a crash leaves nothing behind.

## Software decoding on Android, for now

On Android `hwdec` is `no`. Android's own decoder takes this project's emulator 1080p
streams and then hands mpv no frame at all — in `mediacodec-copy` and in
`mediacodec` alike, while 720p plays — so hardware decoding has never been
seen working here. FFmpeg's decoders play everything the profile claims, and
the profile stops at 1080p while they do the work.

A real phone is what settles it, and a switch for it belongs with the player's
own settings once a player plugin can read them. iOS has no such problem:
VideoToolbox is the default there and falls back rather than stalling.

## Two traps this package holds

- **The player's id, never the player, goes to the native view.** React
  Native's development renderer deep-freezes every prop a view mounts with,
  and a frozen shared object can no longer be released.
- **mpv stops answering if its video output goes while it is playing.** On
  Android, where the system creates and destroys the surface, the view pauses
  before it takes the surface back and takes playback up again when one comes
  back — which is what turning the device does. Letting the player go does not
  touch the video output at all: the core goes, and the picture, the sound and
  the stream with it. On iPhone the layer belongs to the player and outlives
  every view, so the trap does not arise.

## Licence

The binaries are FFmpeg and mpv configured `--enable-gpl --enable-version3`,
which makes them **GPLv3**. The app is AGPL-3.0-or-later, which may link
them: the two licences allow that combination. Shipping a closed build would
need LGPL engines, built from source; that is a plan of its own at the
workspace root.

## Platforms

iOS and Android. There is no mpv for the web, so the manifest does not say
`web` and its profile map has no entry for it.

## Status

The player role is implemented on both phones and tested against a fake of its
Expo module. On the Android emulator it played a portal's raw MPEG-TS channel
and a Jellyfin film straight from the file — Matroska, H.264 with E-AC-3 —
resumed, with the file's own subtitles drawn by libass, turning with the
device, and nothing of the stream in the device log. The iOS half compiles and
links; it has not played yet, and the log wants checking there too.

See `docs/writing-a-plugin/` at the repository root.
