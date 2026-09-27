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
   the user enabled for that connection, on the values the active profile runs
   it with (`services/sources.ts`). Branching on declared alone calls features
   the user switched off.

3. **Only the composition root imports a concrete plugin.** Screens resolve what
   they need from injected services. This is what keeps the boundary real rather
   than aspirational.

4. **Secrets never reach the database** — SQLite on native, IndexedDB on web.
   The database stores opaque refs; values live behind `SecureCredentialStore`
   (keychain on native, encrypted IndexedDB on web). Secrets are manifest
   `password` fields, PINs and session tokens; none of them enters a row, a
   journal entry, a query key, a provider fingerprint or a log. A changed secret
   gets a new ref — never overwrite one in place. Session tokens and the device
   key go in the *device-bound* store, never restored onto another phone.

5. **Writes are local-first.** A user action writes to the local database and
   appends a change-journal entry in one transaction, then returns. The sync
   engine drains the journal later. No network call in a UI interaction path —
   favouriting must work in airplane mode. Local queries and mutations run with
   `networkMode: 'always'`: a browser saying "offline" must not pause them.

6. **Profile separation is enforced twice.** Every user-owned table carries
   `user_id` with a cascade from `users`, *and* every query cache key is
   prefixed with the active user (`userKey()` / `deviceKey()` in
   `src/services/query-keys.ts`). The database alone is not enough.
   Connections belong to the device; what a profile keeps for itself on one —
   its values under the connection's `perProfile` mode — is user-owned and goes
   with the profile. What a source answered is keyed with `remoteKey()`, so a
   local change never refetches every server.

7. **Components take domain types.** `<PosterCard item={item} />`, never
   `<JellyfinPoster raw={payload} />`. Artwork goes through
   `components/artwork.tsx`, which resolves a reference through the media
   service — never a raw URI, because a reference may need an auth header that
   must not sit where a component can read it.

8. **Never try a failed sign-in again on your own.** Servers lock accounts
   after a few failures. A source that answers `UNAUTHORIZED` is parked until
   the user acts, a plugin signs in once per 401 at most, and Test connection /
   Load libraries are buttons — never a probe while someone is typing.

---

## Persistence

`src/persistence/` holds both engines behind `LocalDatabase` (`services/ports.ts`).
`docs/data` explains each rule; these are the ones that break silently.

- **A transaction awaits nothing but its `tx` repositories.** IndexedDB commits
  a transaction the moment it waits on anything else — a keychain call,
  WebCrypto, a fetch — and SQLite deadlocks on a call to the database that
  skips `tx`. A write that also touches secrets is plan (read, write fresh
  secrets) → one transaction (rows, queued stale refs) → clean up
  (`janitor.drain()`). Fresh secrets are deleted again if the transaction fails.
- **Never expo-sqlite's transaction helpers.** `withTransactionAsync` lets
  other statements into the transaction; `withExclusiveTransactionAsync` runs on
  a second connection with foreign keys, and so every cascade, off. Lint rejects
  both. `persistence/sqlite/sql.ts` serializes one connection instead.
- **Never `INSERT OR REPLACE` a parent row.** It deletes first, and the cascade
  takes the children. Update in place.
- **Migrations are numbered, committed, never edited, never destructive.** A
  newer database is refused. A table rebuild is a `foreignKeysOff` step.
- **Journaling is the repositories' job,** in the same transaction. A write that
  changes nothing writes nothing. Device settings and cascaded rows are not
  journaled; the journal's `user_id` does not cascade.
- **Secrets are deleted through the queue.** A ref the rows stop pointing at is
  added to `staleSecrets` in the same transaction; `SecretJanitor` deletes it
  after the commit and at launch. The keychain cannot list its keys, so a missed
  delete lasts for ever.
- **A missing secret is never a sign-in.** When a row lists a saved password the
  store no longer has — after a restore — the pool refuses with
  `MissingSecretError` instead of signing in with nothing.
- **The device key is never in the database,** which backups copy to other
  phones. It lives in the device-bound secure store.
- **Tests run on the real engines** — `node:sqlite` and fake-indexeddb, one
  contract suite for both. Never mock a repository.

---

## Web is a first-class target

Not an afterthought. Things to know:

- **Storage on web is IndexedDB, not SQLite.** No SQLite-wasm, no COOP/COEP
  headers. Not localStorage either: a local-first write needs the data and its
  journal entry in one transaction.
- **The page must be secure** — `https` or `localhost` — because the secrets are
  encrypted with WebCrypto. On plain `http` from a network address the app
  refuses to start (`composition/storage.web.ts`). That is about the page only:
  never require TLS of a source.
- `web.output` is `"single"` — an SPA. Nothing is pre-rendered; do not add
  `+html.tsx` or server-only assumptions.
- `src/app/_layout.tsx` imports `@tamagui/core/reset.css`; without it browser
  defaults (button padding) break components.
- Tabs on web are `src/components/app-tabs.web.tsx`, a top navigation bar.
- A browser's `fetch` must be called unbound (`const { fetch } = deps`), and a
  page on `https` cannot reach an `http` server on the local network.

---

## iOS and Android run Hermes

Hermes lacks built-ins that Node and browsers have — `Array.prototype.toSorted`,
`Object.groupBy`, `crypto.randomUUID`, and possibly `structuredClone`,
`Promise.withResolvers` and `Intl.RelativeTimeFormat`. Code using them
typechecks, passes vitest (Node) and works on the web, then throws on a phone:
Continue Watching broke exactly like that. Lint rejects them in `src/`; copy and
sort (`[...list].sort(compare)`) instead. Plugins run on Hermes too — the
plugins repository's tests scan for the same gaps. The app's TypeScript program
never sees Node's types; only `test/tsconfig.json` does.

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
- Scrolling surfaces are React Native `ScrollView`/`FlatList`, not Tamagui's;
  the full-screen grid is `@shopify/flash-list`, keyed by its column count.
- v5 views default to `position: static` on the web. An overlay's container
  (badges on a poster, text over a hero) needs `position="relative"`, or the
  overlay lands on some ancestor — right on a phone, wrong in a browser.
- React Native components take `pointerEvents` in `style`; the prop is
  deprecated.
- Screen kinds come from `src/components/stack-options.tsx`: tab root,
  full-screen page, detail (transparent header), sheet.
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

Phase 2 — local persistence. Everything survives a restart:

- Three tabs — Media (movies, shows, anime), Videos (videos, files; one tab per
  source), Settings (profiles, PIN lock, plugins).
- Plugins are installed per device. Connections belong to the device, and each
  decides what every profile keeps for itself: nothing, its own sign-in, or
  everything — with PIN-gated profile tabs, "Finish setting up" for profiles
  that have not, and "Don't use for {profile}".
- Media is real: Continue Watching, one row per kind with per-profile order,
  sort and card style, a full-screen grid per row, and detail pages for movies,
  shows, seasons and episodes — from every live source, merged. Jellyfin and
  the mock implement the media role; nothing plays yet.
- Storage: SQLite (`expo-sqlite`) and the keychain on iOS and Android;
  IndexedDB and WebCrypto-encrypted secrets on the web, which requires a secure
  page. Every local change appends a change-journal entry; nothing drains it
  until the account phase.
- There is no development seed: set things up once, and they persist.
  `docs/getting-started` has how to start from scratch.
- Videos still renders skeletons: no plugin lists videos or files yet.
- The service graph is a runtime singleton (`src/composition/provider.tsx`) —
  a router remount must never rebuild it, and in development it survives Fast
  Refresh.
- vitest covers the database on both engines, the credential stores and the
  service layer (`npm test`).

Do not assume anything else described here exists. Build it, then update the
docs in the same commit.

## Verify

```bash
npx expo start          # once: generates the typed-route types
npm run typecheck       # the app, then the tests (test/tsconfig.json)
npx expo lint           # includes the import-boundary, Hermes and SQLite rules
npm test                # vitest: the database, the credential stores, the services
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

Never run Metro with `CI=1` while iterating: CI mode disables file watching.
