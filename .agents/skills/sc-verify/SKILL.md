---
name: sc-verify
description: Run the full verification pass for the Streaming Center app — typecheck, lint, expo-doctor and a real bundle for each target. Use before committing, after touching config or native modules, or when asked whether the app is healthy.
---

# Verify the Streaming Center app

Run these in order. Each catches something the others cannot.

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint
npx expo-doctor       # dependency and config diagnosis
```

Then, for anything touching config, native modules, routes or the plugins
dependency, bundle for real:

```bash
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

**The bundle step is not optional.** `tsc` passes happily while Metro resolution
is broken, a route is invalid, or a `file:` dependency into the plugins
repository fails to resolve. Those only surface in an export.

## Why web gets its own bundle

Web is a first-class target here, and it is the one most likely to break
independently:

- `expo-sqlite` web support is officially **alpha**, and the whole local-first
  design rests on SQLite.
- The web build needs wasm Metro configuration and
  `Cross-Origin-Embedder-Policy: credentialless` plus
  `Cross-Origin-Opener-Policy: same-origin` from whatever serves the bundle,
  because it needs `SharedArrayBuffer`.

An iOS bundle passing tells you nothing about web.

## Cross-repository check

If you changed anything in `../streaming_center_plugins`, typecheck there too —
nothing enforces consistency across the two repositories:

```bash
cd ../streaming_center_plugins && npm run typecheck
```

## Current state — read this before trusting a failure

The repository is a **skeleton**: the `create-expo-app` template plus
documentation. There is no test suite, no `npm test`, and none of the
architecture in `docs/` is implemented.

If you are looking for tests to run, there are none yet. Do not invent a test
command; add real tests first.

## Confirming boundaries once they exist

The layer rules are not yet enforced by lint. When they are, verify they still
bite rather than trusting them:

```bash
# once a boundary rule exists, a deliberate violation MUST fail
npx eslint <the file you just broke>
```
