# Getting started

```bash
cd ../streaming_center_plugins && npm install   # first: plugins resolve @sc/api from here
cd ../streaming_center_app && npm install
npm run android                                 # or npm run ios: builds the development client, the first time
npm start                                       # later: Metro alone, for the build already installed
npm run web                                     # the browser needs no build
```

Phones and simulators run a **development build**, not Expo Go. The app
carries native code — today a small module for deriving keys, which Phase 6
retires; from Phase 7, the video players — and Face ID needs the app's own
usage text. Building it needs the Android SDK or Xcode, and takes a few minutes
the first time; after that, JavaScript changes load as usual. See
`docs/platforms/`.

## The first launch

A device holds one account, so the first launch asks for one. There are three
ways in:

- **Create an account on this device.** Give it a name; the first profile
  takes the same name. It all stays on this device until you sign up on a
  server or export a backup.
- **Sign in to your server.** The account arrives — profiles, PINs, settings
  and sources, with their passwords — and the app asks "Who's watching?".
- **Restore a backup.** Pick a `.scbackup` file and type its key. It becomes a
  local account.

## Set up once

From then on the app opens where you left it: the account, its profiles and
PINs, the connections and their passwords, and each profile's home are kept on
the device.

To add a server, go to Settings → Plugins → Sources, pick the plugin, and add a
connection. The form comes from the plugin itself, and adding a connection is
all it takes. For development against your own
Jellyfin, a test account is the thing to use: a wrong password counts against
the account's lockout on the server.

The workspace root's `jellyfin.env` (gitignored) is a good place to keep the
test server's details at hand. The app never reads it; the `sc-run` skill types
them in from there when it drives the app.

## Your own server

Your own server is PocketBase with the app's collections, in
`../streaming_center_sync`. To run it on your computer:

```bash
cd ../streaming_center_sync
go run . serve                                          # http://localhost:8090; the dashboard is /_/
go run . superuser upsert you@example.com <password>    # or SC_ADMIN_EMAIL and SC_ADMIN_PASSWORD in .env
go run . invite                                         # prints a one-time invite code
```

It needs a recent Go; `../streaming_center_sync/docs/getting-started` has the
details, and what the `.env` holds.

In the app: **Sign in to your server → New here? Create an account**, with
`http://localhost:8090` — the Android emulator reaches the computer at
`http://10.0.2.2:8090` — a username, a password and the invite. From a device
with a local account, creating an account uploads it: its profiles, its
sources, and their passwords. Every other device signs in with the same
username and password, and the account replaces what it held, after asking —
and after offering to export a backup first.

The server keeps source passwords in plain text, for now. Its data folder and
its dashboard are as sensitive as the passwords themselves: keep them private,
and put the server behind TLS anywhere but your home network.

## A pretend account

Development builds have a pretend server too: sign in to **Mock**, and its
endpoint names the account.

- `mock://household` already has two profiles, Sam (PIN 1234) and Robin, so
  signing in shows them arriving.
- Any other endpoint is an empty account.
- It lives in memory. A reload forgets it, and the next run puts back what the
  device holds, as for a server restored from an old backup. Two devices cannot
  share it — your own server is for that.

## Backups

Settings → Plugins → Sync has the backup file. Export it through the share
sheet on a phone, or as a download in a browser; its backup key is shown after
the app asks it's you. Restore it at a first launch, or import it from the same
place, with the key. Importing replaces this device's account with the file's,
as a local account.

To keep backups saved as the account changes, set up a backup target on the
same page. In development builds, **Mock backups** is one, kept in memory: two
browser tabs that imported the same backup can try a conflict against it.

The file holds every password and PIN of the account, encrypted. Without its
key it cannot be opened — by anyone, the app included.

## Starting from scratch

The data is only on the device, so starting fresh means clearing it there:

| Where | How |
| --- | --- |
| Web | a new browser profile, or DevTools → Application → Clear site data |
| iOS simulator | `xcrun simctl uninstall booted <bundle id>`, and `xcrun simctl keychain booted reset` for the secrets, which iOS keeps across an uninstall |
| Android emulator | `adb shell pm clear com.fkg.streamingcenter` |
| Your own server | stop it and delete its data folder (`pb_data`) |

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
