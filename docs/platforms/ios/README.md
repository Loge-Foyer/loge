# iOS

Building and running on simulator and device, native modules, config plugins, and the development build.

The app runs in a **development build**, not Expo Go. The built-in player is
expo-video on AVPlayer (Phase 7), and KSPlayer, mpv (MPVKit) and VLC (VLCKit)
are Expo modules in their own plugins (Phase 8), autolinked into the build.
Face ID needs the app's usage text, which Expo Go cannot carry. Until Phase 6
the app also has a native module of its own, `modules/key-derivation`, which
derives keys from an account password with CommonCrypto's PBKDF2 — JavaScript
on Hermes is far too slow for that (measured: over twenty seconds).

`npm run ios` builds the client and installs it on the simulator; after that,
Metro serves the JavaScript as usual. Change native code, or add a player, and
build again.

## Servers on the local network

App Transport Security refuses plain `http` unless the app says otherwise.
`app.json` does, through `ios.infoPlist`: `NSAllowsLocalNetworking` lets the
app reach a server on the local network — a Jellyfin, or your own server — and
`NSLocalNetworkUsageDescription` is the reason iOS shows when it asks for
local-network permission. Never edit the generated `ios/` folder instead.

The simulator shares the computer's network, so your own server running there
is `http://localhost:8090`.

## Storage

- **The database** is SQLite in the app's documents folder, which iCloud and
  encrypted backups include: `Documents/SQLite/streaming-center.db` in the
  app's data container (`xcrun simctl get_app_container booted <bundle id>
  data`), which `sqlite3` can open once the app is closed.
- **Secrets** are in the keychain, under two services. `sc.credentials` holds
  passwords and PINs, and an encrypted backup restores them onto a new phone.
  `sc.device` holds session tokens, the device key and the backup key, and
  stays on this phone: a restored phone signs in to each server as a device of
  its own, and opening a `.scbackup` there takes the key, typed in.
- Keychain entries can outlive the app. Uninstalling it does not delete them,
  so starting fresh on a simulator is `xcrun simctl uninstall booted
  <bundle id>` plus `xcrun simctl keychain booted reset`.

## Players

- **AVPlayer**, the built-in player through expo-video (Phase 7), plays HLS and
  progressive files, but not raw MPEG-TS over HTTP. A channel that only offers
  `.ts` says it needs another player until Phase 8; the IPTV plugin asks the
  portal for HLS where it can.
- **KSPlayer** runs on iOS only, and is GPL by default: Phase 8 settles its
  licence before it ships.
- Which players are on, and the default, are this device's settings.

## iCloud

iCloud is iOS only, so its plugins appear only here: `sync/icloud` keeps the
backup file in iCloud Drive, and `sources/icloud-drive` brings files from it.
Both are manifests for now. They need the iCloud entitlements and the Apple
Developer Program, and come in a later phase.

## The backup file

From Phase 6, export goes through the share sheet — to Files, AirDrop,
anywhere — and import through the document picker. The backup key is shown
only after the owner check.

## Forgot PIN and Face ID

On your own server, Forgot PIN asks for the account's password. On a local
account — or when the server has let this device go — it asks the device,
through `expo-local-authentication`: Face ID or Touch ID, falling back to the
passcode. Only `src/platform/owner-authentication.ts` imports it; the web gets
`owner-authentication.web.ts`, which answers "unavailable".

- **Face ID works in the development build**, which carries the app's usage
  text (`faceIDPermission`, set through the module's config plugin in
  `app.json`). Expo Go could not.
- **A simulator has no passcode.** Enrol Face ID in the simulator's Features
  menu to be asked at all. Without it, on a local account, the unlock screen
  shows a hint instead of the "Forgot PIN?" link.

## The simulator

- `npm run ios` builds, installs and opens the development build. Opened again
  by hand, it shows its launcher: pick the running Metro server.
- Deep links use the app's own scheme, `streamingcenterapp://<path>`.
