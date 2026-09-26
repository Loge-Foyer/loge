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

Against a real Jellyfin server, from the workspace's gitignored `jellyfin.env`
(`web_ui` or `ip`, `username`, `password`):

```bash
npm run start:jellyfin              # -- --web | --ios | --android
```

Same profiles, plus one shared Jellyfin connection. The script prints key names
only — never echo that file's values anywhere. The password is inlined into the
development bundle, so it is for a test account on your own network. A failed
sign-in counts against the account's lockout: do not loop a wrong password.

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
Accessibility permission, and `xcrun simctl openurl` stops at an "Open in Expo
Go?" prompt every time — on iOS 18 and 26 alike — that only a tap answers. Open
the project without it:

```bash
xcrun simctl install <UDID> ~/.expo/ios-simulator-app-cache/Expo-Go-<version>.tar.app   # if missing
xcrun simctl launch --terminate-running-process <UDID> host.exp.Exponent --initialUrl "exp://127.0.0.1:8081"
```

That start URL is not handed to the app as a deep link (expo-router reads
`getLinkingURL()`, which it leaves empty), so on iOS without Accessibility you
get the home screen only. Screens behind navigation are driven on Android or in
a browser. Metro's inspector socket refuses outside debuggers, so it is no way
in either.

In Expo Go the app's own scheme does not apply — deep links use the Metro URL
with `/--/`, e.g. `exp://127.0.0.1:8081/--/browse/movies`.
`streamingcenterapp://<path>` (from `app.json`) is for development and store
builds. A link lands on a cold start too: `(app)` stays reachable while the app
starts. Only a profile with a PIN, or no default profile, drops it.

Useful paths: `/media`, `/browse/<rowId>` (`movies`, `shows`, `anime`),
`/customize-home`, `/settings/plugins/<pluginId>`. Item pages
(`/item/<connectionId>/<itemId>`) carry ids generated at launch, so reach them
by tapping.

Expo Go shows a developer-menu introduction on first launch. Skip it on iOS:

```bash
xcrun simctl spawn <UDID> defaults write host.exp.Exponent EXDevMenuIsOnboardingFinished -bool YES
```

Its floating developer button then sits over the header's right side; it is not
part of the app.

Android — taps work, so do screenshots and deep links, with no prompt:

```bash
emulator -avd shinie-a36 -no-window -no-audio -no-boot-anim &   # headless
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081/--/<path>"
adb shell input tap <x> <y>                  # screenshot pixels, not scaled
adb exec-out screencap -p > /tmp/shot.png
adb logcat -s ReactNativeJS                  # the app's console output
```

On first launch Expo Go opens its developer-menu introduction: tap Continue,
then close the menu. Make sure Wi-Fi is the default network
(`adb shell dumpsys connectivity | grep "Active default"`) — on mobile data a
local-only source is rightly skipped. `adb shell svc wifi disable|enable`
switches, which is the quickest real test of parking and recovery.

If Expo Go is missing on the emulator, `npx expo start --android` installs it,
or reuse the cached APK: `adb install ~/.expo/android-apk-cache/Expo-Go-<version>.apk`.

In a browser, automation must navigate inside the app: a full page load is a
fresh in-memory state, seeded again. Headless Chrome with
`--remote-debugging-port` and Node's built-in `WebSocket` is enough to drive it
over the DevTools protocol:

- Row links and cards render as `<a>`; Settings rows as `[tabindex="0"]`; tabs
  and chips as `[role=tab]`; switches as `[role=switch][aria-label=…]`.
- Inputs are found through their label (`label[for]` → `id`); focus one, then
  send `Input.insertText` — React ignores a value set directly.
- The PIN pad takes key events (`Input.dispatchKeyEvent`).
- `Network.enable` and `Network.requestWillBeSent` count what a source asked;
  a browser adds a CORS preflight (`OPTIONS`) to each authenticated request.

## What you will actually see right now

- **First launch** — "Who is this?": name the first profile.
- **Three tabs** — Media, Videos, Settings. Native tab bars on iOS and Android;
  a top navigation bar in the browser. Dark only.
- **Media** — an empty state until a source is connected. Then Continue
  Watching (landscape cards with progress), a row per kind (posters with
  ratings, watched checks and progress bars), a title link to each row's
  full-screen grid, and detail pages. With the Jellyfin seed the titles and
  artwork are the server's; the mock draws coloured placeholders instead of
  artwork. A source that cannot answer shows one quiet line with Retry.
- **Customize** (the sliders button, top right) — per-row order, visibility,
  sort and card style, per profile.
- **Videos** — one tab per source, skeleton shelves: nothing lists videos yet.
- **Settings** — the current profile, all profiles, PIN lock, and every plugin:
  install it on the device and add connections through forms built from each
  plugin's manifest, choosing what each profile keeps for itself.
