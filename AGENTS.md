# AGENTS.md — streaming_center_app

The Streaming Center client: an Expo/React Native app targeting **iOS, Android
and web**. Read the workspace root `AGENTS.md` and
`../.claude/streaming-center-architecture.md` first.

This repository owns **the experience**. It does not own domain types or any
adapter — those live in `streaming_center_plugins`.

---

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely
renamed, moved, or removed. Before writing any code that touches an Expo, EAS,
or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all
   Expo docs with corrections to common LLM misconceptions. Follow its links to
   the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file
  there is a screen, `_layout.tsx` files define navigators. Keep non-route code
  (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`,
`eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or
Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects,
or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in
docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Expo rules

- If `ios/` and `android/` directories do not exist, they are generated
  (Continuous Native Generation). Never create or edit them by hand — configure
  native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with
  native code, the app needs a development build: `npx expo run:ios|android`
  locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your
  available skills before adding dependencies.
  Docs: https://docs.expo.dev/versions/latest/index.md

---

## Project invariants

These are specific to Streaming Center and matter more than anything above.

1. **Never define a domain type here.** `MediaItem`, `GlobalMediaKey`, the
   capability types and every plugin contract live in `@sc/api`, in the
   plugins repository. Defining them here makes the dependency graph circular.

2. **No plugin names above the composition root.** There must never be an
   `if (providerId === 'jellyfin')` in a screen, component or service. Branch on
   **effective** capabilities — what the plugin declares, intersected with what
   the user enabled for that connection. Branching on declared alone calls
   features the user switched off.

3. **Only the composition root imports a concrete plugin.** Screens resolve what
   they need from injected services. This is what keeps the boundary real rather
   than aspirational.

4. **Secrets never reach the database** — SQLite on native, IndexedDB on web.
   The database stores opaque refs; values live behind `SecureCredentialStore`
   (keychain on native, encrypted IndexedDB on web, in memory today). A secret
   is exactly a manifest `password` field. Never log a token, a header or a PIN.

5. **Writes are local-first.** A user action writes to the local database and
   appends a change-journal entry in one transaction, then returns. The sync
   engine drains the journal later. No network call in a UI interaction path —
   favouriting must work in airplane mode.

6. **Profile separation is enforced twice.** Every user-owned table carries
   `user_id` with a cascade from `users`, *and* every query cache key is
   prefixed with the active user (`userKey()` / `deviceKey()` in
   `src/services/query-keys.ts`). The database alone is not enough.
   Connections of a plugin in device mode are device-owned and shared on
   purpose; per-profile mode makes them user-owned.

7. **Components take domain types.** `<MediaCard item={item} />`, never
   `<JellyfinPoster raw={payload} />`. Artwork goes through a resolver, never a
   raw URI — a reference may carry an auth header that must not sit where a
   component can read it.

---

## Web is a first-class target

Not an afterthought. Things to know:

- **Storage on web is IndexedDB, not SQLite** (decided; in memory today). No
  SQLite-wasm, no COOP/COEP headers. Not localStorage either: a local-first
  write needs the data and its journal entry in one transaction.
- `web.output` is `"single"` — an SPA. Nothing is pre-rendered; do not add
  `+html.tsx` or server-only assumptions.
- `src/app/_layout.tsx` imports `@tamagui/core/reset.css`; without it browser
  defaults (button padding) break components.
- Tabs on web are `src/components/app-tabs.web.tsx`, a top navigation bar.

---

## Consuming plugins

The plugins are a separate repository, so npm workspaces cannot span them. They
are linked with `file:` dependencies — `@sc/api` plus one `@sc/plugin-<id>` per
plugin — and Metro watches the folder:

```js
// metro.config.js — this is all of it
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../streaming_center_plugins')];
```

- Install the plugins repository first; plugin files resolve `@sc/api` from it.
- Plugins take `@sc/api` as a **peer** dependency: one copy, one set of brands.
- `npm ls --all` shows `UNMET DEPENDENCY @sc/api@*` under each linked plugin.
  Cosmetic — npm does not resolve deps of links outside the root.
- No `resolver.nodeModulesPaths` is needed: babel-preset-expo imports its
  runtime helpers by absolute path (verified in dev and production bundles).
- Register a plugin in `src/composition/plugins.ts` — the only file that may
  import one; lint enforces it. Every plugin exports `plugin`.

**This is the main technical risk in the repository split.** Verify with a
real export, not a typecheck.

---

## UI

- **Tamagui 2.7.7** (`v5` preset) is the one component system. Pin every
  `@tamagui/*` package to the same exact version.
- **One theme entry point:** `src/tamagui.config.ts`. Never add a second theme
  or styling system beside it. `@expo/ui` is installed because expo-router
  depends on it — do not use it for screens.
- v5 is **shorthands-only** (`bg`, `p`, `rounded`, `items`…); media keys are
  min-width (`$sm`, `$md`, `$lg`, `$xl`).
- Native-drawn chrome (NativeTabs, stack headers, native switches) takes
  resolved colours: `String(theme.x.val)`.
- Scrolling surfaces are React Native `ScrollView`/`FlatList`, not Tamagui's.
- Forms render from manifests (`src/components/manifest-form/`), switching on
  `field.type` only. Never write a form for a specific plugin.

---

## Skills

`.agents/skills/` in this repository:

- **`sc-verify`** — the full verification pass. Use before committing.
- **`sc-run`** — launch on simulator, emulator or browser.
- **`sc-use-plugin`** — wiring a plugin from the plugins repository.

Plus 13 official skills from [`expo/skills`](https://github.com/expo/skills) —
`expo-router`, `expo-ui`, `expo-native-ui`, `expo-design-system`,
`expo-animation`, `expo-data-fetching`, `expo-module`, `expo-dev-client`,
`expo-project-structure`, `expo-upgrade`, `expo-examples`, `expo-overview`,
`eas-hosting`.

Install more with:

```bash
npx skills add expo/skills --skill <name> --agent universal --copy
```

`--agent universal` targets `.agents/skills/`; `--copy` writes real files rather
than symlinks so they commit with the repository. `npx skills update` refreshes
them.

Prefer a skill over answering from memory — the Expo ones exist precisely
because training data goes stale between SDK releases.

---

## Current state

First slice, storage **in memory**:

- Three tabs — Media (movies, shows, anime), Videos (videos, files; one tab per
  source), Settings (profiles, PIN lock, plugins).
- Plugins are installed per device; each can be configured per profile
  (off by default); connections are created from each plugin's manifest.
- Media and Videos render skeletons: no plugin implements a role, so there are
  no titles. `MediaItem` does not exist yet.
- The service graph is a runtime singleton (`src/composition/provider.tsx`) —
  a router remount must never rebuild it.
- No app-side tests yet.

Do not assume anything else described here exists. Build it, then update the
docs in the same commit.

## Verify

```bash
npx expo start          # once: generates the typed-route types
npx tsc --noEmit
npx expo lint           # includes the import-boundary rules
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

Never run Metro with `CI=1` while iterating: CI mode disables file watching.
