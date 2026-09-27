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
`expo-crypto`, `react-native-screens`, `expo-sqlite`, `expo-secure-store` —
ships in Expo Go 57.

That changes the moment a playback engine lands. Expo Go only bundles its own
native modules, so a custom one requires a development build:

```bash
npx expo run:ios      # or run:android
```

Once that happens, a Metro reload will not pick up native changes — you must
rebuild, and the failure mode looks like code that did not change.

**Never start Metro with `CI=1` while iterating.** CI mode turns off file
watching: every edit after startup is silently served stale.

## Data persists — set it up once

There is no development seed. Everything — profiles, PINs, installed plugins,
connections and their passwords, layouts — is kept on the device, so set up what
a flow needs once and it is there on every later launch.

- **A first launch** needs a fresh start: a new browser profile (a fresh
  `--user-data-dir`), `xcrun simctl uninstall booted host.exp.Exponent` plus
  `xcrun simctl keychain booted reset`, or `adb shell pm clear host.exp.exponent`.
- **A real Jellyfin server**: Settings → Plugins → Jellyfin → Installed → Add
  connection, filled in from the workspace's gitignored `jellyfin.env`
  (`web_ui` or `ip`, `username`, `password`). Read it in the driving script and
  type the values in; never echo them anywhere. A failed sign-in counts against
  the account's lockout: do not loop a wrong password.
- **Offline work**: the `mock` plugin (development builds only) is a pretend
  server that needs no network. Install it and add a connection like any other.
- **In a browser, stay on `localhost`.** On plain `http` from a network address
  the app refuses to start: its secrets need WebCrypto, which only a secure page
  has.

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
`/customize-home`, `/settings/plugins/<pluginId>`, `/settings/pin`. Item pages
(`/item/<connectionId>/<itemId>`) carry the connection's generated id, so reach
them by tapping.

Without Accessibility permission the iOS simulator cannot be tapped, so prove
persistence there by reading the database: stop the app, then run `sqlite3` on
`…/ExponentExperienceData/<project>/SQLite/streaming-center.db` in the Expo Go
data container (`xcrun simctl get_app_container <UDID> host.exp.Exponent data`).

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

In a browser, a full page load keeps everything — IndexedDB lives in the
Chrome profile — so navigating by URL is fine; start with a fresh
`--user-data-dir` for a first launch. Headless Chrome with
`--remote-debugging-port` and Node's built-in `WebSocket` is enough to drive it
over the DevTools protocol:

- Row links and cards render as `<a>`; Settings rows as `[tabindex="0"]`; tabs
  and chips as `[role=tab]`; switches as `[role=switch][aria-label=…]`.
- Inputs are found through their label (`label[for]` → `id`); focus one, then
  send `Input.insertText` — React ignores a value set directly.
- The PIN pad takes key events (`Input.dispatchKeyEvent`).
- `Network.enable` and `Network.requestWillBeSent` count what a source asked;
  a browser adds a CORS preflight (`OPTIONS`) to each authenticated request. A
  reload should make no new `POST /Users/AuthenticateByName`: the session is
  kept, encrypted, in `streaming-center-secrets`.
- `Runtime.evaluate` can read IndexedDB (`indexedDB.open('streaming-center')`)
  to check what was stored — refs, never a password.

## What you will actually see right now

- **First launch** — "Who is this?": name the first profile.
- **Three tabs** — Media, Videos, Settings. Native tab bars on iOS and Android;
  a top navigation bar in the browser. Dark only.
- **Media** — an empty state until a source is connected. Then Continue
  Watching (landscape cards with progress), a row per kind (posters with
  ratings, watched checks and progress bars), a title link to each row's
  full-screen grid, and detail pages. Connected to Jellyfin, the titles and
  artwork are the server's; the mock draws coloured placeholders instead of
  artwork. A source that cannot answer shows one quiet line with Retry.
- **Customize** (the sliders button, top right) — per-row order, visibility,
  sort and card style, per profile.
- **Videos** — one tab per source, skeleton shelves: nothing lists videos yet.
- **Settings** — the current profile, all profiles, PIN lock, and every plugin:
  install it on the device and add connections through forms built from each
  plugin's manifest, choosing what each profile keeps for itself.
