# iOS

Building and running on simulator and device, native modules, config plugins, and the development build.

The app runs in a **development build**, not Expo Go: it has a native module of
its own, `modules/key-derivation`, which derives keys from an account password
with CommonCrypto's PBKDF2. JavaScript on Hermes is far too slow for that
(measured: over twenty seconds). `npm run ios` builds the client and installs it
on the simulator; after that, Metro serves the JavaScript as usual. Change the
Swift, or add a native module, and build again.

## Servers on the local network

App Transport Security refuses plain `http` unless the app says otherwise.
`app.json` does, through `ios.infoPlist`: `NSAllowsLocalNetworking` lets the
app reach a server on the local network — a Jellyfin, or your own sync server —
and `NSLocalNetworkUsageDescription` is the reason iOS shows when it asks for
local-network permission. Never edit the generated `ios/` folder instead.

## Storage

- **The database** is SQLite in the app's documents folder, which iCloud and
  encrypted backups include: `Documents/SQLite/streaming-center.db` in the
  app's data container (`xcrun simctl get_app_container booted <bundle id>
  data`), which `sqlite3` can open once the app is closed.
- **Secrets** are in the keychain, under two services. `sc.credentials` holds
  passwords and PINs, and an encrypted backup restores them onto a new phone.
  `sc.device` holds session tokens and the device key, and stays on this
  phone: a restored phone signs in to each server as a device of its own.
- Keychain entries can outlive the app. Uninstalling it does not delete them,
  so starting fresh on a simulator is `xcrun simctl uninstall booted
  <bundle id>` plus `xcrun simctl keychain booted reset`.

## Forgot PIN and Face ID

Forgot PIN asks the account when it can vouch for its owner, and otherwise the
device, through `expo-local-authentication`: Face ID or Touch ID, falling back
to the passcode. Only `src/platform/owner-authentication.ts` imports it; the web
gets `owner-authentication.web.ts`, which answers "unavailable".

- **Face ID works in the development build**, which carries the app's usage
  text (`faceIDPermission`, set through the module's config plugin in
  `app.json`). Expo Go could not.
- **A simulator has no passcode.** Enrol Face ID in the simulator's Features
  menu to be asked at all; without it and without an account, the unlock
  screen shows "Forgot it? An account lets you reset a PIN." instead of the
  link.

## The simulator

- `npm run ios` builds, installs and opens the development build. Opened again
  by hand, it shows its launcher: pick the running Metro server.
- Deep links use the app's own scheme, `streamingcenterapp://<path>`.
