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

4. **Secrets never reach SQLite.** The database stores opaque refs; values live
   in the keychain. Never log a token, a header or a PIN.

5. **Writes are local-first.** A user action writes to the local database and
   appends a change-journal entry in one transaction, then returns. The sync
   engine drains the journal later. No network call in a UI interaction path —
   favouriting must work in airplane mode.

6. **Profile separation is enforced twice.** Every user-owned table carries
   `user_id` with a cascade from `users`, *and* every query cache key is
   prefixed with the active user. The database alone is not enough.

7. **Components take domain types.** `<MediaCard item={item} />`, never
   `<JellyfinPoster raw={payload} />`. Artwork goes through a resolver, never a
   raw URI — a reference may carry an auth header that must not sit where a
   component can read it.

---

## Web is a first-class target

Not an afterthought. Two things to know:

- `expo-sqlite` web support is officially **alpha**. The whole local-first
  design rests on SQLite, so this is the main risk on web.
- The web build needs wasm Metro configuration and
  `Cross-Origin-Embedder-Policy: credentialless` plus
  `Cross-Origin-Opener-Policy: same-origin` on whatever serves the bundle,
  because it needs `SharedArrayBuffer`.

Both belong in `docs/platforms/web/` as they are worked out.

---

## Consuming plugins

The plugins are a separate repository, so npm workspaces cannot span them. For
local development use a `file:` dependency plus a Metro watch folder:

```jsonc
// package.json
"dependencies": {
  "@sc/api": "file:../streaming_center_plugins/api"
}
```

```js
// metro.config.js
config.watchFolders = [path.resolve(__dirname, '../streaming_center_plugins')];
```

**This is the main technical risk in the repository split.** Metro resolution
across a repository boundary — symlinks, duplicate React copies, hoisting — is
exactly the class of problem `tsc` cannot see. Verify with a real export, not a
typecheck.

---

## Current state

The unmodified `create-expo-app` default template plus this documentation.
`src/app/` still contains the template's `index.tsx` and `explore.tsx`; `src/`
contains its demo components. None of the architecture described above is
implemented yet.

Do not assume anything described here exists. Build it, then update the docs in
the same commit.

## Verify

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
npx expo export --platform web --output-dir /tmp/sc-web
```
