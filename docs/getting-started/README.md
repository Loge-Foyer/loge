# Getting started

```bash
cd ../streaming_center_plugins && npm install   # first: plugins resolve @sc/api from here
cd ../streaming_center_app && npm install
npm start                                       # then i / a / w, or npm run ios|android|web
```

Expo Go is enough on a device or simulator; no development build is needed yet.

## Set up once

The first launch asks "Who is this?" and names the first profile. From then on
the app opens where you left it: profiles, PINs, installed plugins, connections
and their passwords, and each profile's home are kept on the device.

To add a server, go to Settings → Plugins, install it, and add a connection.
The form comes from the plugin itself. For development against your own
Jellyfin, a test account is the thing to use: a wrong password counts against
the account's lockout on the server.

The workspace root's `jellyfin.env` (gitignored) is a good place to keep the
test server's details at hand. The app never reads it; the `sc-run` skill types
them in from there when it drives the app.

## Starting from scratch

The data is only on the device, so starting fresh means clearing it there:

| Where | How |
| --- | --- |
| Web | a new browser profile, or DevTools → Application → Clear site data |
| iOS simulator | `xcrun simctl uninstall booted host.exp.Exponent`, and `xcrun simctl keychain booted reset` for the secrets, which iOS keeps across an uninstall |
| Android emulator | `adb shell pm clear host.exp.exponent` |

In Expo Go that clears every project Expo Go has opened.

## In a browser

Open the app from `localhost`, as `npm run web` does. A browser keeps passwords
safe — encrypted with WebCrypto — only on a secure page: `https`, or
`localhost`. Opened over plain `http` from a network address, the app refuses
to start and says why.

Nothing asks your server to use `https`: from `localhost` the app reaches a
Jellyfin at `http://192.168.1.20:8096` as it is. The reverse does not work — a
page on `https`, even with a self-signed certificate, cannot call an `http`
server; that is the browser's mixed-content rule. See `docs/platforms/web/`.

## Good to know

- Run the dev server once before typechecking: it generates the typed-route
  types in `.expo/types`.
- Don't start Metro with `CI=1` while you work — CI mode stops it watching
  files, and your edits are silently ignored.
- Fast Refresh keeps the service graph as it was: reload (`r`) after changing a
  service. Building a second graph would open the database a second time.
- A server on your network is reached over plain `http`. Expo Go allows that;
  see `docs/platforms/` for what development builds and the web need.
