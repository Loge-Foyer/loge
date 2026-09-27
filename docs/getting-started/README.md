# Getting started

```bash
cd ../streaming_center_plugins && npm install   # first: plugins resolve @sc/api from here
cd ../streaming_center_app && npm install
npm run android                                 # or npm run ios: builds the development client, the first time
npm start                                       # later: Metro alone, for the build already installed
npm run web                                     # the browser needs no build
```

Phones and simulators run a **development build**, not Expo Go: the app has a
small native module of its own, for deriving keys from an account password.
Building it needs the Android SDK or Xcode, and takes a few minutes the first
time; after that, JavaScript changes load as usual. See `docs/platforms/`.

## Set up once

The first launch offers to sign in to an account, or to use the device on its
own and name its first profile. From then on the app opens where you left it:
profiles, PINs, installed plugins, connections and their passwords, and each
profile's home are kept on the device.

To add a server, go to Settings → Plugins, install it, and add a connection.
The form comes from the plugin itself. For development against your own
Jellyfin, a test account is the thing to use: a wrong password counts against
the account's lockout on the server.

The workspace root's `jellyfin.env` (gitignored) is a good place to keep the
test server's details at hand. The app never reads it; the `sc-run` skill types
them in from there when it drives the app.

## Your own server

Two devices share an account through a sync server you run
(`../streaming_center_sync`):

```bash
cd ../streaming_center_sync && npm install && npm run build && npm start
npm run sc-sync -- invite
```

In the app: **Sign in → Your own server → New here? Create an account**, with
`http://localhost:8730` (the Android emulator reaches the computer at
`http://10.0.2.2:8730`), a username, a password of ten characters or more, and
the invite. Every other device signs in with the same username and password —
and its connections arrive with their passwords, sealed on the device that had
them.

## A pretend account

Development builds have a pretend one too: sign in to **Mock**, and its
endpoint names the account.

- `mock://household` already has two profiles, Sam (PIN 1234) and Robin, so
  signing in shows them arriving — and, on a device with profiles of its own,
  the "Keep both" question.
- Any other endpoint is an empty account.
- It lives in memory. A reload forgets it, and the app joins it again with
  nothing lost; two devices cannot share it — your own server is for that.

## Starting from scratch

The data is only on the device, so starting fresh means clearing it there:

| Where | How |
| --- | --- |
| Web | a new browser profile, or DevTools → Application → Clear site data |
| iOS simulator | `xcrun simctl uninstall booted <bundle id>`, and `xcrun simctl keychain booted reset` for the secrets, which iOS keeps across an uninstall |
| Android emulator | `adb shell pm clear com.fakg.streaming_center_app` |

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
- A server on your network is reached over plain `http`. The development
  build allows it (`docs/platforms/`); a page on `https` does not.
