---
name: sc-run
description: Launch the Streaming Center app on the iOS simulator, Android emulator or a browser and confirm a change works in the real app. Use when asked to run, start, open, screenshot or visually verify something.
---

# Run the Streaming Center app

```bash
npm run ios        # iOS simulator
npm run android    # Android emulator
npm run web        # browser
npm start          # dev server, then press i / a / w
```

## Which runtime you need

**Expo Go is enough today.** Every native module in use — `react-native-svg`,
`expo-crypto`, `react-native-screens` — ships in Expo Go 57.

That changes the moment a playback engine lands. Expo Go only bundles its own
native modules, so a custom one requires a development build:

```bash
npx expo run:ios      # or run:android
```

Once that happens, a Metro reload will not pick up native changes — you must
rebuild, and the failure mode looks like code that did not change.

**Never start Metro with `CI=1` while iterating.** CI mode turns off file
watching: every edit after startup is silently served stale.

## Seeded data

Storage is in memory, so every reload is a first launch (Welcome → name a
profile). To start past it:

```bash
EXPO_PUBLIC_DEV_SEED=1 npx expo start --clear       # opens as Kids; Alex has PIN 1234
EXPO_PUBLIC_DEV_SEED=locked npx expo start --clear  # Alex is the default: PIN pad at launch
```

Both seeds install the `mock` plugin with one shared connection. The variable is
read at bundle time, so change it only together with `--clear`.

## Verified on this machine

- **iOS** — Xcode 27, simulators for iOS 18.0 and 18.2 (iPhone 16 family, iPad
  Pro/Air/mini)
- **Android** — SDK 36, AVD `shinie-a36` (arm64, Play image), JDK 21
- **Web** — any browser; `web.output` is a single-page app, so a static host
  needs to fall back to `index.html` for deep paths

## Screenshots without a human

```bash
xcrun simctl list devices available | grep iPhone
xcrun simctl boot <UDID> && open -a Simulator
xcrun simctl io <UDID> screenshot /tmp/shot.png
```

Scripted tapping via `System Events` fails with `-25204` unless the terminal has
Accessibility permission, so drive navigation with deep links instead. In Expo
Go the app's own scheme does not apply — use the Metro URL with `/--/`:

```bash
xcrun simctl openurl <UDID> "exp://127.0.0.1:8081/--/settings/plugins"
```

`streamingcenterapp://<path>` (from `app.json`) is for development and store
builds. A deep link only lands once the app is past its boot gate: on a cold
start the gate's own screen wins, so open the app first, then link.

Expo Go shows a developer-menu introduction on first launch. Skip it on iOS:

```bash
xcrun simctl spawn <UDID> defaults write host.exp.Exponent EXDevMenuIsOnboardingFinished -bool YES
```

Android — taps work, so do screenshots and deep links:

```bash
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081/--/<path>"
adb shell input tap <x> <y>
adb exec-out screencap -p > /tmp/shot.png
```

If Expo Go is missing on the emulator, `npx expo start --android` installs it,
or reuse the cached APK: `adb install ~/.expo/android-apk-cache/Expo-Go-<version>.apk`.

In a browser, automation must navigate inside the app: a full page load is a
fresh in-memory state. Headless Chrome with `--remote-debugging-port` and
Node's built-in `WebSocket` is enough to drive it over the DevTools protocol.

## What you will actually see right now

- **First launch** — "Who is this?": name the first profile.
- **Three tabs** — Media, Videos, Settings. Native tab bars on iOS and Android;
  a top navigation bar in the browser. Dark only.
- **Media and Videos** show an empty state until a source is connected, then
  skeleton shelves (Media) or one tab per source (Videos). No titles exist yet:
  plugins export manifests only.
- **Settings** — the current profile, all profiles, PIN lock, and every plugin:
  install it on the device, choose shared or per-profile configuration, and add
  connections through forms built from each plugin's manifest.
