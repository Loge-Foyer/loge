---
name: sc-verify
description: Run the full verification pass for the Streaming Center app — typecheck, lint (import-boundary and Hermes rules), tests, expo-doctor, a real bundle for each target, and the check that no development secret reaches a production bundle. Use before committing, after touching config or native modules, or when asked whether the app is healthy.
---

# Verify the Streaming Center app

Run these in order. Each catches something the others cannot.

```bash
npx expo start        # once, then stop it: it generates .expo/types (typed routes)
npm run typecheck     # tsc --noEmit — strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess
npm run lint          # expo lint, including the boundary and Hermes rules below
npm test              # vitest over test/ — the service layer
npx expo-doctor       # dependency and config diagnosis
```

Typed routes are generated only by the dev server, never by `expo export`.
Without `.expo/types`, `tsc` accepts any `href` and a broken link type-checks.

Then, for anything touching config, native modules, routes or the plugins
dependency, bundle for real:

```bash
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

**The bundle step is not optional.** `tsc` passes happily while Metro resolution
is broken, a route is invalid, or a `file:` dependency into the plugins
repository fails to resolve. Those only surface in an export.

## No development secret in a production bundle

`npm run start:jellyfin` inlines a real password into the development bundle.
Prove an export never carries it — export with sentinel values, then search:

```bash
EXPO_PUBLIC_DEV_SEED=jellyfin EXPO_PUBLIC_DEV_JELLYFIN_URL=http://sc-sentinel-host:8096 \
EXPO_PUBLIC_DEV_JELLYFIN_USERNAME=SC_SENTINEL_USER EXPO_PUBLIC_DEV_JELLYFIN_PASSWORD=SC_SENTINEL_42 \
  npx expo export --platform web --source-maps --output-dir /tmp/sc-web
grep -rl -e SC_SENTINEL_42 -e SC_SENTINEL_USER -e sc-sentinel-host /tmp/sc-web   # must print nothing
```

The seed's `process.env.EXPO_PUBLIC_DEV_JELLYFIN_*` reads sit behind `__DEV__`,
so a production build drops them. Moving one outside that check leaks the
password into every export.

While the source maps are there, check the vocabulary is bundled once: the
`sources` of the web map should list each `streaming_center_plugins/api/src/*`
file exactly once.

## Boundaries — a deliberate violation must fail

`eslint.config.js` turns the composition-root rule (spec §15) into lint errors:

| Import | Allowed only in |
| --- | --- |
| `@sc/plugin-*` | `src/composition/**` |
| `@/persistence/*` (and relative `…/persistence/…`) | `src/composition/**` |
| `@/platform/*` (and relative `…/platform/…`) | `src/composition/**` |
| `@/composition/*` | `src/app/_layout.tsx` |

Do not trust them, prove them. Drop a throwaway file into `src/screens/` that
imports one of each — including a relative `../platform/clock` — and run
`npx eslint` on it. Every import must be an error. Delete the file.

## Hermes rules

iOS and Android run Hermes, which lacks `Array.prototype.toSorted`,
`Object.groupBy` and `crypto.randomUUID`. Tests run on Node and the web runs V8,
so nothing else notices until a phone throws. Lint rejects all three anywhere
in `src/`; add `[1].toSorted()` to the throwaway file above and it must fail
too. The plugins repository's `test/engine.test.ts` scans its sources for the
same list.

## Why web gets its own bundle

Web is a first-class target and breaks independently of native:

- It renders through react-native-web with Tamagui's web reset
  (`@tamagui/core/reset.css`, imported in `src/app/_layout.tsx`). Without the
  reset, browser defaults such as button padding break switches and buttons.
- The tab bar is a different component on web (`app-tabs.web.tsx`).
- `web.output` is `"single"`: one `index.html`, no pre-rendering.

An iOS bundle passing tells you nothing about web.

## Cross-repository check

If you changed anything in `../streaming_center_plugins`, verify there too —
nothing enforces consistency across the two repositories:

```bash
cd ../streaming_center_plugins && npm run typecheck && npm test
```

## Current state — read this before trusting a failure

- Storage is **in memory**: every reload is a first launch unless the dev seed
  is on (`sc-run`).
- `npm test` covers services, not screens. Screens are proven by driving the
  app on each platform (`sc-run`).
- Tamagui 2.7.7 logs a dev-only "`AlertDialogContent` requires a description"
  warning on web even though the dialog is described — its check runs before
  the portal mounts. Confirm with the DOM (`aria-describedby` resolves) rather
  than silencing it.
