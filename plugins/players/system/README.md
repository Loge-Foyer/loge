# Built-in player

The device's own player, through expo-video: AVPlayer on iPhone and iPad,
Media3 (ExoPlayer) on Android, and the browser's `<video>` on the web, with
hls.js where the browser cannot play HLS itself.

## Category

**Player** — `players/system`. Device-wide: each device switches it on or off,
and may make it the default.

## What it plays

HLS everywhere; MP4, and on Android MKV and MPEG-TS; what else depends on the
platform. Its profile per platform says exactly which — and a source that
transcodes, such as Jellyfin, shapes its answer to it.

## Platforms

iOS, Android and the web.

## Status

Manifest only, with no profile yet, so the app never picks it. The engine
arrives in Phase 7.
