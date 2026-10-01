# Platforms

What differs per target. Each page — [iOS](ios/README.md),
[Android](android/README.md), [Apple TV](tvos/README.md), [web](web/README.md)
— covers build steps, native modules and platform-specific caveats.

## Plugins say where they run

Every manifest lists its `platforms`, and the app lists and runs only the
plugins that include the one it is on. A connection that belongs to the account
but whose plugin cannot run here stays inert, labelled "not available on this
device", and is kept for the devices that can.

| | iOS | Android | Web |
| --- | --- | --- | --- |
| Storage | SQLite, the keychain | SQLite, the keystore | IndexedDB, secrets encrypted with WebCrypto |
| Build | a development build | a development build | none; a secure page |
| The built-in player, `players/system` (Phase 7) | expo-video: AVPlayer | expo-video: Media3 / ExoPlayer | `<video>`, with hls.js where HLS is not native |
| More players | mpv (MPVKit), built but not yet played | mpv (libmpv), in since Phase 8 | mpegts.js, inside the built-in player |
| IPTV | browsing yes; raw MPEG-TS channels wait for a player (Phase 9) | yes | hidden until a proxy exists |
| Plain-`http` servers | `NSAllowsArbitraryLoads` | `usesCleartextTraffic`, debug and release | the page's own origin rules |
| Backup targets (later phases) | iCloud, Google Drive, OneDrive | Google Drive, OneDrive | Google Drive, OneDrive |
| The backup file | share sheet, document picker | share sheet, document picker | download, file input; sql.js loaded for it |
| Forgot PIN, on a local account | Face ID, Touch ID or the passcode | a fingerprint or the screen lock | not offered: a PIN stays until it is typed |

## Development builds

Phones run a development build, not Expo Go. Player engines are native code —
expo-video, and an Expo module for mpv — and Face ID needs the
app's usage text. A player plugin's module has to be autolinked into the build
from its linked package; Phase 8 proved that path on Android, and Phase 9
repeats it on iOS, where the module is a podspec beside the package's
`ios/` folder rather than a Gradle project beside its `android/` one.

Change native code, or add a player, and build again: a stale build looks like
code that did not change. The web needs no build.

## TV

**Apple TV runs the app** — the same screens, built for tvOS through
react-native-tvos, with branches where a television differs: the remote, the
type and spacing read from across a room, and the things a TV does not have
(files, Face ID, downloads). [`tvos/README.md`](tvos/README.md) has how to
build it and what changed to get there. Android TV gets the same runtime
branches (`Platform.isTV`) and has not been built yet.
