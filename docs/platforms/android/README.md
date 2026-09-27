# Android

Building and running on emulator and device, native modules, and Android-specific configuration.

Expo Go is enough today. The Material tab bar is themed from Tamagui explicitly, because it would otherwise follow the system's light theme under a dark app.

## Servers on the local network

Expo Go allows plain `http`. A development or store build blocks cleartext
traffic from Android 9 on, so it will need a network security configuration
allowing it to local addresses — set through a config plugin in `app.json` when
the development build arrives.

## Storage

- **The database** is SQLite in the app's files folder, which Android's Auto
  Backup includes, up to its 25 MB limit.
- **Secrets** are encrypted under the Android keystore. Keystore keys cannot be
  restored, so expo-secure-store's config plugin (in `app.json`) leaves that
  data out of backups. It takes effect in development and store builds.
- **After a restore**, the database is back but its secrets are not. A source
  whose saved password is missing is never signed in without it — servers lock
  accounts after failed logins. Instead it says it needs its password again.
  A profile whose PIN is missing opens for its owner.
- `adb shell pm clear host.exp.exponent` starts Expo Go, and every project in
  it, from scratch.

## Forgot PIN

Without an account that can vouch for its owner, Forgot PIN asks the device:
a fingerprint, or the screen lock's PIN, pattern or password. It is offered once
a screen lock is set — `getEnrolledLevelAsync()` reports at least `SECRET` — and
works in Expo Go.

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
- Deep links work cold or warm, with no prompt:
  `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081/--/browse/movies"`.
- JavaScript logs go to logcat under `ReactNativeJS`.
