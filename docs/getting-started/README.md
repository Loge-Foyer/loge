# Getting started

```bash
cd ../streaming_center_plugins && npm install   # first: plugins resolve @sc/api from here
cd ../streaming_center_app && npm install
npm start                                       # then i / a / w, or npm run ios|android|web
```

Expo Go is enough on a device or simulator; no development build is needed yet.

## A first launch every time

Nothing is stored yet — profiles, plugins and connections live in memory, so
each reload starts at "Who is this?". To skip ahead during development:

```bash
EXPO_PUBLIC_DEV_SEED=1 npx expo start --clear       # opens as Kids; Alex has PIN 1234
EXPO_PUBLIC_DEV_SEED=locked npx expo start --clear  # opens on Alex's PIN pad
```

Both seeds connect the `mock` plugin, a pretend server that works offline.

## Against a real Jellyfin server

Put the server's details in `jellyfin.env` at the workspace root, next to this
repository — it is gitignored there:

```
web_ui=http://192.168.1.20:8096
username=a-test-account
password=its-password
```

`ip=` works instead of `web_ui=`; `:8096` is added when no port is given. Then:

```bash
npm run start:jellyfin              # or -- --web, --ios, --android
```

The script seeds the same profiles plus one shared Jellyfin connection, filled
in by field type, so it is there again after every reload. It prints only the
key names it found. `SC_JELLYFIN_ENV` points it at another file.

**Use a test account.** The password is inlined into the development bundle,
which Metro serves to anyone on your network. The script refuses to run under
`CI`, and a production export never contains it — `sc-verify` checks.

## Good to know

- Run the dev server once before typechecking: it generates the typed-route
  types in `.expo/types`.
- Don't start Metro with `CI=1` while you work — CI mode stops it watching
  files, and your edits are silently ignored.
- A server on your network is reached over plain `http`. Expo Go allows that;
  see `docs/platforms/` for what development builds and the web need.
