# Android

Building and running on emulator and device, native modules, and Android-specific configuration.

Expo Go is enough today. The Material tab bar is themed from Tamagui explicitly, because it would otherwise follow the system's light theme under a dark app.

## Servers on the local network

Expo Go allows plain `http`. A development or store build blocks cleartext
traffic from Android 9 on, so it will need a network security configuration
allowing it to local addresses — set through a config plugin in `app.json` when
the development build arrives.

## The emulator

- An emulator has both mobile data and Wi-Fi. Check which is the default
  network (`adb shell dumpsys connectivity | grep "Active default"`): on mobile
  data a local-only source is rightly skipped, with "only used on your home
  network". `adb shell svc wifi disable` and `enable` switch between them, which
  is also the quickest way to see a parked source come back.
- Deep links work cold or warm, with no prompt:
  `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081/--/browse/movies"`.
- JavaScript logs go to logcat under `ReactNativeJS`.
