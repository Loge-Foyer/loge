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

## Good to know

- Run the dev server once before typechecking: it generates the typed-route
  types in `.expo/types`.
- Don't start Metro with `CI=1` while you work — CI mode stops it watching
  files, and your edits are silently ignored.
