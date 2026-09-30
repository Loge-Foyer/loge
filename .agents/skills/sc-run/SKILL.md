---
name: sc-run
description: Launch the Streaming Center app on the iOS simulator, Android emulator or a browser and confirm a change works in the real app — including a first launch, your own server (PocketBase) run locally, and exporting or importing a backup. Use when asked to run, start, open, screenshot or visually verify something.
---

# Run the Streaming Center app

```bash
npm run ios        # builds the development client, installs it on the simulator, opens it
npm run android    # the same on the emulator
npm run web        # browser — no build
npm start          # Metro alone, for a development client already installed
```

**Phase 6 — the code is on the new architecture; nothing plays until Phase 7.**
This skill describes the target, and says where today differs. "What you will see" at the end has
both.

## Which runtime you need

**A development build, not Expo Go.** Expo Go carries only its bundled
modules, and the app needs more: player engines are native code (expo-video
from Phase 7, Expo modules for KSPlayer, mpv and VLC in Phase 8), and Face ID
needs the app's usage text. The app has no native module of its own any more:
Phase 4's key derivation went with its vault, so a build made before Phase 6
carries a module nothing uses — build again.

`npm run android` / `npm run ios` build the client (the first Android build
took about seven minutes), install it and start it against Metro. After that,
JavaScript changes load as usual; a change to `modules/`, a config plugin in
`app.json`, a new native dependency or a player plugin needs the build again —
and a stale build looks like code that did not change. Face ID works in the iOS
development build, which carries the app's usage text.

**Never start Metro with `CI=1` while iterating.** CI mode turns off file
watching: every edit after startup is silently served stale.

## Data persists — set it up once

There is no development seed. Everything — the account, profiles, PINs,
connections and their passwords, layouts — is kept on the device, so set up
what a flow needs once and it is there on every later launch.

- **A first launch** needs a fresh start: a new browser profile (a fresh
  `--user-data-dir`), `xcrun simctl uninstall booted <bundle id>` plus
  `xcrun simctl keychain booted reset`, or
  `adb shell pm clear com.fakg.streaming_center_app`. Welcome then offers three
  ways in: **Create an account on this device** (a name, which the first
  profile takes too), **Sign in to your server**, or **Restore a backup**.
- **A real Jellyfin server**: Settings → Plugins → Sources → Jellyfin → Add
  connection, filled in from the workspace's gitignored `jellyfin.env`
  (`web_ui` or `ip`, `username`, `password`). Read it in the driving script and
  type the values in; never echo them anywhere. A failed sign-in counts against
  the account's lockout: do not loop a wrong password.
- **Offline work**: the mock plugins (development builds only) need no
  network. `sources/mock` is a pretend library, and `iptv/mock` pretend
  channels, a guide and a little VOD for the TV tab (Phase 7). Add a
  connection like any other. `iptv/mock` is not built yet.
- **A real account: your own server** — PocketBase. Give it a data directory
  of its own:

  ```bash
  cd ../streaming_center_sync
  go run . serve --dir /tmp/sc-pb &                                           # http://127.0.0.1:8090, dashboard at /_/
  go run . superuser upsert admin@example.com <a-password> --dir /tmp/sc-pb   # the dashboard's login
  go run . invite --dir /tmp/sc-pb                                            # a one-time invite code
  ```

  Then **Sign in to your server → New here? Create an account**, at
  `http://localhost:8090` in a browser or the iOS simulator, and
  `http://10.0.2.2:8090` on the Android emulator (or `adb reverse tcp:8090
  tcp:8090` and `localhost`). From a device with a local account, creating the
  account uploads it. A second device signs in with the same username and
  password, confirms that the account replaces its own, and gets the
  connections with their passwords.
  - The dashboard (`http://localhost:8090/_/`) shows each account's records —
    the sources' passwords among them, in plain text, as designed for now.
  - PocketBase logs each request: a second `auth-with-password` for one
    "Sign in" means the session handover broke.
  - To try a lost phone, change the account's password (in the dashboard, or
    from another device): the other device is refused once, then asks, and
    never tries again by itself.
  - `rm -rf /tmp/sc-pb` starts the server from scratch.
- **A pretend account**: `sync/mock`, in development builds. Sign
  in to it — at first launch, or in Settings → Account — and its endpoint names
  the account: `mock://household` holds Sam (PIN 1234) and Robin, any other
  endpoint is empty. It lives in the JavaScript runtime's memory: a reload
  forgets it, and the next run puts back what the device holds, as for a
  server restored from an old backup. Nothing local is lost.
- **A backup**: Settings → Plugins → Sync → Export — the share sheet
  on a phone, a download in a browser — and Show the backup key, after the
  owner check. Import it on another device with the key: at first launch
  through Restore a backup, or from the same Sync page. Importing replaces
  that device's account with a local one.
  - In headless Chrome, `Browser.setDownloadBehavior` (`behavior: 'allow'`,
    a `downloadPath`) catches the export, and `DOM.setFileInputFiles` hands a
    file to the import's file input.
  - On the Android emulator, `adb push <file> /sdcard/Download/` puts a file
    where the document picker finds it.
- **In a browser, stay on `localhost`.** On plain `http` from a network address
  the app refuses to start: its secrets need WebCrypto, which only a secure page
  has.

## Verified on this machine

- **iOS** — Xcode 27, simulators for iOS 18.0 and 18.2 (iPhone 16 family, iPad
  Pro/Air/mini)
- **Android** — SDK 36, AVD `shinie-a36` (arm64, Play image), JDK 21
- **Web** — any browser; `web.output` is a single-page app, so a static host
  needs to fall back to `index.html` for deep paths

## The account and Forgot PIN, per platform

- **Your own server** — "Forgot PIN?" opens a password form in place of the
  PIN pad. After too many wrong passwords the server throttles, and the form
  says "Too many tries" (your server takes five sign-ins a minute). Once the
  server no longer takes the device's saved password — changed elsewhere —
  the device asks itself instead.
- **Web** — "Forgot PIN?" works with a server account, or with the mock (it
  vouches for its owner). On a local account the unlock screen shows a hint and
  no link.
- **Android emulator** — a screen lock and a fingerprint, without the Settings
  app: `adb shell locksettings set-pin 1111`, then `adb shell am start -a
  android.settings.FINGERPRINT_ENROLL`, type `1111`, accept, and
  `adb -e emu finger touch 1` about ten times until "Fingerprint added". At the
  app's prompt, `touch 1` answers yes and `touch 2` (an unenrolled finger) no.
- **iOS simulator** — no passcode. In the development build, Face ID can be
  enrolled from the simulator's Features menu; otherwise, on a local account,
  there is only the hint.

Sign out, Switch, importing a backup and showing the backup key ask for the
owner the same way when the device has profiles; at first launch nothing is
asked.

## Screenshots without a human

```bash
xcrun simctl list devices available | grep iPhone
xcrun simctl boot <UDID> && open -a Simulator
xcrun simctl io <UDID> screenshot /tmp/shot.png
```

Scripted tapping via `System Events` fails with `-25204` unless the terminal has
Accessibility permission, so on iOS without it you get whatever screen a launch
lands on. `npm run ios` builds, installs and opens the development build; opened
again by hand (`xcrun simctl launch <UDID> <bundle id>`), it shows its launcher,
which lists the running Metro server. Screens behind navigation are driven on
Android or in a browser. Metro's inspector socket refuses outside debuggers, so
it is no way in either.

Deep links use the app's own scheme, `streamingcenterapp://<path>` (from
`app.json`). A link lands on a cold start too: `(app)` stays reachable while
the app starts. Only a profile with a PIN, or no default profile, drops it.

Useful paths: `/media`, `/videos`, `/tv`, `/browse/<rowId>`
(`movies`, `shows`, `anime`), `/customize-home`, `/settings/plugins/<category>`
and `/settings/plugins/<category>/<name>`, `/settings/pin`. Item pages
(`/item/<connectionId>/<itemId>`) carry the connection's generated id, so reach
them by tapping.

Without Accessibility permission the iOS simulator cannot be tapped, so prove
persistence there by reading the database: stop the app, then run `sqlite3` on
`Documents/SQLite/streaming-center.db` in the app's data container
(`xcrun simctl get_app_container <UDID> <bundle id> data`).

The development build shows a developer-menu introduction on first launch. Skip
it on iOS:

```bash
xcrun simctl spawn <UDID> defaults write <bundle id> EXDevMenuIsOnboardingFinished -bool YES
```

Android — taps work, so do screenshots and deep links, with no prompt:

```bash
emulator -avd shinie-a36 -no-window -no-audio -no-boot-anim &   # headless
npx expo start --dev-client                  # Metro, for the installed development build
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp+streamingcenterapp://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
adb shell am start -a android.intent.action.VIEW -d "streamingcenterapp://<path>"   # a deep link
adb shell input tap <x> <y>                  # screenshot pixels, not scaled
adb exec-out screencap -p > /tmp/shot.png
adb logcat -s ReactNativeJS                  # the app's console output
adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml   # every node: text, bounds, focused
```

Typing on Android with `adb shell input text` has traps:

- **Only into a field that has focus.** Tap it, then check `focused="true"` in
  a dump first. Keys that reach no field go to the development build itself:
  `r` twice reloads the app, `d` opens its menu.
- **Whether a soft keyboard shows depends on the emulator's settings** — on
  `shinie-a36` it does, and it covers the buttons under a form. A dump still
  lists the nodes beneath it, so a tap there types a key into the field
  instead (a password gains a character, and the server rightly refuses it).
  Close the keyboard first, and only when one is showing: `adb shell dumpsys
  input_method | grep mInputShown=true`, then Back. Pressed with no keyboard
  up, Back navigates back.
- **`autoFocus` does not focus a field on Android:** tap it, and check
  `focused="true"`, before typing.
- **Dumps carry no hints:** find a form's fields as the `EditText` nodes from
  top to bottom.
- **Give the app a moment** before tapping the button after it: React takes in
  the typed text a little later, and a button that is disabled until then
  ignores the tap. A dump's `enabled` is no guide for Tamagui buttons.
- The accessibility dumps are heavy: an emulator short on memory answers
  everything slower while you poll.

On first launch the development build opens its developer-menu introduction
over the app: tap Continue, then close the menu. Make sure Wi-Fi is the default network
(`adb shell dumpsys connectivity | grep "Active default"`) — on mobile data a
local-only source is rightly skipped. `adb shell svc wifi disable|enable`
switches, which is the quickest real test of parking and recovery.

If the development build is missing on the emulator, or anything native
changed, `npm run android` builds and installs it again.

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
- A header title can read the same as a button ("Sign in" is both on the
  sign-in page): click the match that sits inside a `button`, `a` or
  `[tabindex="0"]`. Section titles are upper-cased by style, so `innerText`
  reads "KEPT IN STEP", not "Kept in step".
- Navigating by URL is a full page load: the app starts again, a profile with
  a PIN asks for it, and the mock account forgets. Stay in the app — tabs, rows,
  the back arrow — to keep a flow's state.
- `Network.enable` and `Network.requestWillBeSent` count what a source asked;
  a browser adds a CORS preflight (`OPTIONS`) to each authenticated request. A
  reload should make no new `POST /Users/AuthenticateByName`: the session is
  kept, encrypted, in `streaming-center-secrets`.
- `Runtime.evaluate` can read IndexedDB (`indexedDB.open('streaming-center')`)
  to check what was stored — refs, never a password.

## What you will see

The target, once Phase 6 has landed:

- **First launch** — Welcome, with its three ways in. A new local account opens
  on its one profile; a server account with profiles lands on "Who's
  watching?".
- **Four tabs** — Media, Videos, TV, Settings. Native tab bars on iOS and
  Android; a top navigation bar in the browser. Dark only.
- **Media** — an empty state until a source is connected. Then Continue
  Watching (landscape cards with progress), a row per kind (posters with
  ratings, watched checks and progress bars), a title link to each row's
  full-screen grid, and detail pages. Connected to Jellyfin, the titles and
  artwork are the server's; the mock draws coloured placeholders instead of
  artwork. A source that cannot answer shows one quiet line with Retry; where
  its titles were saved, they stay, and the line says how old they are.
  `Network.setBlockedURLs` on the server's host shows that in a browser;
  `adb shell svc wifi disable` on Android (a local-only server is then skipped).
- **Customize** (the sliders button, top right) — per-row order, visibility,
  sort and card style, per profile.
- **Videos** — one tab per source, skeleton shelves: nothing lists videos yet.
- **TV** — its empty state, pointing to Settings → Plugins → IPTV. Live, Movies
  and Series fill in with Phase 7. In a browser IPTV is hidden, so it stays
  empty there.
- **Settings** — the account first (local, or "Synced just now · 1 change
  waiting"), then the current profile, profiles (up to ten: "Add a profile"
  goes at the limit), PIN lock, and Plugins as four rows — Sources, IPTV,
  Players, Sync — each opening this platform's list. iCloud shows on iOS only.
  Nothing plays.

**Today (nothing plays):**

- Welcome offers "Create an account on this device", "Sign in to your server"
  (the mock too, in development) and "Restore a backup". An account with
  profiles lands on "Who's watching?".
- Four tabs — Media, Videos, TV, Settings; TV shows its empty state.
- Settings → Plugins is four lists — Sources, IPTV, Players, Sync — of what
  runs on this platform. Add a connection through a form built from its
  manifest, and choose what each profile keeps for itself.
- Settings → Account shows a local account, or your server's with Sync now,
  what it keeps in step, Sign in again, Switch account and Sign out. Profiles
  stop at ten, or at the server's limit.
- Settings → Plugins → Sync has the backup file — Export, Import, Show the
  backup key — and, in development, Mock backups as a target. Players each
  have a switch and "Play with it first".
- Headless Chrome drives the backup flows: `Page.setInterceptFileChooserDialog`
  and `DOM.setFileInputFiles` answer the picker, `Browser.setDownloadBehavior`
  catches the export, and `Target.createBrowserContext` is a second device
  with an IndexedDB of its own.
