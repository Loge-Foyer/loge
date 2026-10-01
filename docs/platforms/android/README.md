# Android

Building and running on emulator and device, native modules, and Android-specific configuration.

The app runs in a **development build**, not Expo Go. The built-in player is
expo-video on Media3 / ExoPlayer, and mpv (libmpv) is an Expo module in its own
adapter, autolinked into the build. **Android 8 is the floor**
(`minSdkVersion` 26, through `expo-build-properties`): libmpv's binaries ask
for it.
The app's own native module is `modules/sc-pip`, which asks Android for
picture in picture on behalf of whichever engine is playing — packaging and
window management are the app's, not an adapter's. Phase 4's key derivation
module went with its vault.

`npm run android` builds the client and installs it; after that, Metro serves
the JavaScript as usual. Change native code, or add a player, and build again.

The Material tab bar is themed from Tamagui explicitly, because it would
otherwise follow the system's light theme under a dark app.

## Servers over plain HTTP

Android blocks cleartext from Android 9 on. Two things allow it here, and only
one of them covers a release build:

- The development build is a debug build, whose *generated debug* manifest
  allows plain `http` on its own — a Jellyfin on your network, your own server,
  and Metro itself.
- `expo-build-properties` sets `android.usesCleartextTraffic` in `app.json`,
  which writes the attribute onto `<application>` in the **main** manifest, so
  release builds reach the same servers. Without it a release build fails for
  every plain-`http` source, and looks like a bug in the source rather than in
  packaging.

Never edit the generated `android/` folder instead. iOS needs the same thing
said differently — see `../ios/README.md`.

The emulator reaches the computer at `10.0.2.2`, so your own server running
there is `http://10.0.2.2:8090` — or `adb reverse tcp:8090 tcp:8090`, and
`http://localhost:8090`.

## Storage

- **The database** is SQLite in the app's files folder, which Android's Auto
  Backup includes, up to its 25 MB limit.
- **Secrets** are encrypted under the Android keystore. Keystore keys cannot be
  restored, so expo-secure-store's config plugin (in `app.json`) leaves that
  data out of backups. It takes effect in development and store builds.
- **After a restore**, the database is back but its secrets are not. A source
  whose saved password is missing is never signed in without it — servers lock
  accounts after failed logins. Instead it says it needs its password again.
  A profile whose PIN is missing opens for its owner. The backup key is gone
  too, so opening a `.scbackup` takes the key, typed in.
- `adb shell pm clear com.fkg.streamingcenter` starts the app from scratch
  (the package is `android.package` in `app.json`).

## Players

- **ExoPlayer**, the built-in player through expo-video, plays HLS and
  MPEG-TS, so IPTV channels play on it.
- **mpv** is for what it cannot: some containers, codecs and subtitle formats
  — Matroska with DTS or TrueHD as the file, with libass drawing the
  subtitles the file styles. It decodes in software for now, so its profile
  stops at 1080p; a real phone is what settles hardware decoding.
- Which players are on, which plays first, and which plays first on each tab,
  are this device's settings.
- **VLC was dropped in Phase 9.** mpv already played everything it did, and a
  second engine of that size cost 37 MB of framework. Git has it.

## The backup file

From Phase 6, export goes through the share sheet and import through the
document picker. On the emulator, `adb push <file> /sdcard/Download/` puts a
file where the picker finds it. The backup key is shown only after the owner
check.

## Forgot PIN

On your own server, Forgot PIN asks for the account's password, and the server
checks it. On a local account — or when the server has let this device go — it
asks the device: a fingerprint, or the screen lock's PIN, pattern or password.
It is offered once a screen lock is set — `getEnrolledLevelAsync()` reports at
least `SECRET`.

On the emulator: Settings → Security → Screen lock → PIN, then Fingerprint,
touching the sensor with `adb -e emu finger touch 1` when asked. At the app's
prompt, the same command answers it; `adb -e emu finger touch 2` (an unenrolled
finger) is a refusal.

## The emulator

- An emulator has both mobile data and Wi-Fi. Check which is the default
  network (`adb shell dumpsys connectivity | grep "Active default"`): on mobile
  data a local-only source is rightly skipped, with "only used on your home
  network". `adb shell svc wifi disable` and `enable` switch between them, which
  is also the quickest way to see a parked source come back.
- The development build connects to Metro through its own scheme, after
  `adb reverse tcp:8081 tcp:8081`:
  `adb shell am start -a android.intent.action.VIEW -d "exp+streamingcenterapp://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"`.
- Deep links work cold or warm, with no prompt:
  `adb shell am start -a android.intent.action.VIEW -d "streamingcenterapp://browse/movies"`.
- JavaScript logs go to logcat under `ReactNativeJS`.
