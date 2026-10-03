# Android

Building and running on emulator and device, native modules, and Android-specific configuration.

The app runs in a **development build**, not Expo Go. The built-in player is
expo-video on Media3 / ExoPlayer, and mpv (libmpv) is an Expo module in its own
adapter, autolinked into the build. **Android 8 is the floor**
(`minSdkVersion` 26, through `expo-build-properties`): libmpv's binaries ask
for it.
The app's own native modules are `modules/loge-pip`, which asks Android for
picture in picture on behalf of whichever engine is playing — packaging and
window management are the app's, not an adapter's — and `modules/loge-volume`,
the music stream's volume that the player's edge moves. Phase 4's key derivation
module went with its vault.

`npm run android` builds the client and installs it; after that, Metro serves
the JavaScript as usual. Change native code, or add a player, and build again.

The Material tab bar is themed from Tamagui explicitly, so it follows the
app's own Appearance — light, dark, or the system's — rather than the
system's alone.

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
  too, so opening a `.logebackup` takes the key, typed in.
- `adb shell pm clear com.fkg.loge` starts the app from scratch
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
- **VLC** is libVLC 3.7 (`org.videolan.android:libvlc-all`), quietened with
  `--quiet`. It brings its own `libc++_shared.so` as libmpv does, and the
  app's `with-newest-libcxx` still packages libmpv's, which libVLC loads too.
  It plays first on TV on a new device.

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
  `adb shell am start -a android.intent.action.VIEW -d "exp+loge://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"`.
- Deep links work cold or warm, with no prompt:
  `adb shell am start -a android.intent.action.VIEW -d "loge://browse/movies"`.
- JavaScript logs go to logcat under `ReactNativeJS`.

## The app icon

An adaptive icon, as Android's guide describes one: 108 dp layers with the
art inside the 66 dp safe zone, and a monochrome layer for themed icons
(Android 13 and later). The layers are the finished design's
(`.claude/Finished Design/Android/Loge/` at the workspace root).

- **`android.adaptiveIcon` in `app.json`:**
  - the foreground (`assets/images/android-icon-foreground.png`) and
    monochrome (`android-icon-monochrome.png`) layers, at 432², which is
    xxxhdpi. Expo resizes them for every density.
  - the background is a colour, `#4a0b14`, not an image. Expo takes a colour
    or an image there, nothing in between. `#4a0b14` is the design's
    gradient at the icon's centre, and its average.
- **PNGs, not vectors.** Converting the design's SVGs to VectorDrawables
  drops their stroke gradients.
- **The root `icon`** (`assets/images/icon.png`, the flat render) makes the
  legacy `ic_launcher` and `ic_launcher_round` webps. With `minSdkVersion` 26
  nothing shows them.
- **A suggested app in the dock** sits on a plate tinted from the wallpaper.
  That plate is the Pixel launcher's, not the icon's; the app drawer shows the
  icon as it is.
