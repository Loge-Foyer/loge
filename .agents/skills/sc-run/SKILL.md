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

**Expo Go is enough today.** The app currently uses no custom native modules.

That changes the moment a playback engine lands. Expo Go only bundles its own
native modules, so a custom one requires a development build:

```bash
npx expo run:ios      # or run:android
```

Once that happens, a Metro reload will not pick up native changes — you must
rebuild, and the failure mode looks like code that did not change.

## Verified on this machine

- **iOS** — Xcode 27, simulators for iOS 18.0 and 18.2 (iPhone 16 family, iPad
  Pro/Air/mini)
- **Android** — SDK 36, AVD `shinie-a36` (arm64, Play image), JDK 21
- **Web** — any browser; note the COEP/COOP header requirement once SQLite is
  wired

## Screenshots without a human

```bash
xcrun simctl list devices available | grep iPhone
xcrun simctl boot <UDID> && open -a Simulator
xcrun simctl io <UDID> screenshot /tmp/shot.png
```

Scripted tapping via `System Events` fails with `-25204` unless the terminal has
Accessibility permission, so drive navigation with deep links instead:

```bash
xcrun simctl openurl <UDID> "streamingcenterapp://<path>"
```

The scheme is `streamingcenterapp`, from `app.json`.

Android equivalent:

```bash
adb shell am start -a android.intent.action.VIEW -d "streamingcenterapp://<path>"
adb exec-out screencap -p > /tmp/shot.png
```

## What you will actually see right now

The repository is a **skeleton** — the `create-expo-app` template. Two demo
screens, `index` and `explore`, and none of the Streaming Center architecture.

There are no profiles, no home rows, no search and no seed data yet. If you were
expecting a profile picker, it does not exist; that is the target described in
`docs/`, not the present.
