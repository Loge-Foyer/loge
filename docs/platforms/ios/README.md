# iOS

Building and running on simulator and device, native modules, config plugins, and when a development build replaces Expo Go.

Expo Go is enough today: every native module in use ships with it. A development build becomes necessary with the first custom native module — the playback engine.

## Servers on the local network

Expo Go allows plain `http` to a server on your network. A development or store
build will not until the app says so: App Transport Security needs
`NSAllowsLocalNetworking`, and iOS 14 and later ask for local-network permission
(`NSLocalNetworkUsageDescription`). Both go in `app.json` when the development
build arrives — never as edits to a generated `ios/` folder.

## Storage

- **The database** is SQLite in the app's documents folder, which iCloud and
  encrypted backups include. Inside Expo Go each project has its own folder:
  `Documents/ExponentExperienceData/<project>/SQLite/streaming-center.db`,
  which `sqlite3` can open once the app is closed.
- **Secrets** are in the keychain, under two services. `sc.credentials` holds
  passwords and PINs, and an encrypted backup restores them onto a new phone.
  `sc.device` holds session tokens and the device key, and stays on this
  phone: a restored phone signs in to each server as a device of its own.
- Keychain entries can outlive the app. Uninstalling it does not delete them,
  so starting fresh on a simulator is `xcrun simctl uninstall booted
  host.exp.Exponent` plus `xcrun simctl keychain booted reset`.

## The simulator

- `xcrun simctl openurl` asks "Open in Expo Go?" every time, and the prompt
  cannot be answered without a tap. Open the project without it:
  `xcrun simctl launch <UDID> host.exp.Exponent --initialUrl exp://127.0.0.1:8081`.
  That start URL is not handed on as a deep link, so it always opens the home.
- Expo Go's developer button floats over the top right of the screen, over the
  header's actions. It is not part of the app.
