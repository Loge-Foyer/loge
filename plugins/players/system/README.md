# Built-in player

The device's own player, through expo-video: AVPlayer on iPhone and iPad,
Media3 (ExoPlayer) on Android, and the browser's `<video>` on the web, with
hls.js where the browser cannot play HLS itself.

## Category

**Player** — `players/system`. Device-wide: each device switches it on or off,
and may make it the default.

## What it plays

Its profile per platform (`src/profiles.ts`) says exactly what, and a source
that transcodes, such as Jellyfin, shapes its answer to it:

| | Protocols | Files | Video | Audio |
| --- | --- | --- | --- | --- |
| iOS — AVPlayer | HLS, progressive | MP4, M4V, MOV | H.264, HEVC | AAC, MP3, AC-3, E-AC-3, ALAC, FLAC |
| Android — Media3 | HLS, DASH, MPEG-TS, progressive | MP4, M4V, MOV, MKV, WebM, TS | H.264, HEVC, VP9 | AAC, MP3, Opus, Vorbis, FLAC |
| Web — `<video>` | HLS, progressive | MP4, M4V, WebM | H.264, VP9 | AAC, MP3, Opus, Vorbis, FLAC |

A codec only some devices decode — AV1, AC-3 on Android, HEVC in a browser —
is left out: claiming it would send someone to a black screen instead of the
player that plays it. AVPlayer has raw MPEG-TS only inside HLS, so a channel
that offers nothing else needs another player on iOS.

## How it works

- **`src/engine.ts`** — phones. One `createVideoPlayer` per controller; a load
  goes through `replaceAsync`, off the UI thread, with the stream's content
  type and its headers, resolved at load time. The start position and the
  tracks asked for are applied once the stream is ready: AVPlayer drops a seek
  made before then.
- **`src/engine.web.ts`** — browsers. The controller owns its `<video>`; the
  view only places it, so a remount never restarts the stream. HLS plays
  natively where the browser can (Safari, Chrome from 143) and through hls.js
  elsewhere, or whenever the stream needs a header — only hls.js's own
  requests can carry one. hls.js is fetched through `import()`, a chunk of its
  own, and runs without a worker. A file that needs a header, or a protocol a
  browser lacks, is refused loudly.
- **`src/view.tsx`, `src/view.web.tsx`** — the `PlayerView`: expo-video's
  `VideoView` with its own controls hidden (the app draws the controls, the
  same for every engine), or a box the `<video>` goes into. The view finds its
  engine behind the controller; given another player's, it throws.

What it tells, as `PlayerEvent`s:

- **A state once,** and a new listener hears the current one at once.
  "Playing" follows what was asked for — a stream turns ready before it
  starts, and Media3 is not "playing" while it buffers — so a screen never
  flashes a pause. The empty player's own events, before anything is loaded,
  are ignored.
- **The position once a second,** with the duration unless the stream is live.
- **Tracks by their place** — `audio-0`, `subtitle-1` — because iOS gives
  expo-video's tracks no id; once per change.
- **Every failure as a `failed` state and an `AppError`:** a refused stream
  (`UNAUTHORIZED`), a missing one (`NOT_FOUND`), one the browser cannot decode
  (`INVALID_STATE`), and the rest as `PROVIDER_UNAVAILABLE`, worth trying
  again. hls.js's fatal media error is recovered once first, as its authors
  advise. A browser that will not start without a tap leaves it paused, not
  failed. A released player refuses everything.

## Dependencies

`@sc/api`, `@sc/player-kit`, React, React Native, expo-video and hls.js, all
peers: the app installs them, so autolinking builds expo-video and there is one
copy of each. This repository has them as development dependencies, for the
players' TypeScript program and the tests.

## Platforms

iOS, Android and the web.

## Status

The player role is implemented, with a profile per platform, and tested
against fakes of expo-video, the `<video>` element and hls.js. On the Android
emulator its view played HLS, live HLS, raw MPEG-TS and MP4, and in Chrome HLS
(native, and through hls.js) and MP4. iOS waits for the workspace path to lose
its space. The app does not open it yet: the player screen comes next.
