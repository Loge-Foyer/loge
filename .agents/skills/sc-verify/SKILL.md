---
name: sc-verify
description: Run the full verification pass for the Streaming Center app — typecheck (app and tests), lint (import-boundary, Hermes and SQLite rules), tests on both database engines, expo-doctor, a real bundle for each target with only its own storage in it and sql.js only in a lazily loaded web chunk, and the check that no secret reaches the database. Use before committing, after touching config, storage, backups, players or native modules, or when asked whether the app is healthy.
---

# Verify the Streaming Center app

Run these in order. Each catches something the others cannot.

```bash
npm run android       # after a native change (modules/, app.json plugins, a new native dependency or player): rebuild the development client
npx expo start        # once, then stop it: it generates .expo/types (typed routes)
npm run typecheck     # the app, then test/tsconfig.json — strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess
npm run lint          # expo lint, including the boundary, Hermes and SQLite rules below
npm test              # vitest over test/ — the database on SQLite and IndexedDB, the credential stores, the services
npx expo-doctor       # dependency and config diagnosis
```

Typed routes are generated only by the dev server, never by `expo export`.
Without `.expo/types`, `tsc` accepts any `href` and a broken link type-checks.

Then, for anything touching config, native modules, routes, backups, players or
the plugins dependency, bundle for real:

```bash
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

**The bundle step is not optional.** `tsc` passes happily while Metro resolution
is broken, a route is invalid, or a `file:` dependency into the plugins
repository fails to resolve. Those only surface in an export.

## Each bundle carries only its own storage

`src/composition/storage.ts` (native) and `storage.web.ts` are chosen by
platform, and so is `src/platform/owner-authentication.web.ts`, the stub that
keeps `expo-local-authentication` out of the web. If either leaked into the
other bundle, web would drag in expo-sqlite's WebAssembly build — and need
COOP/COEP headers — or native would ship dead IndexedDB code:

```bash
grep -rl -e wa-sqlite -e expo-sqlite -e ExpoSecureStore -e ExpoLocalAuthentication -e KeyDerivation /tmp/sc-web   # must print nothing
strings /tmp/sc-ios/_expo/static/js/ios/*.hbc | grep -c streaming-center-secrets  # must print 0
strings /tmp/sc-ios/_expo/static/js/ios/*.hbc | grep -c KeyDerivation             # must print 0
```

The host crypto is one file for every platform, `src/platform/crypto.ts`:
expo-crypto, with WebCrypto behind it in a browser, and noble. `KeyDerivation`
is Phase 4's native module, retired: it must not come back into either
bundle.

With `--source-maps` on the web export, also check the vocabulary is bundled
once: the `sources` of the web map should list each
`streaming_center_plugins/api/src/*` file exactly once.

## sql.js only for backups, only on the web

The backup file is built with expo-sqlite on native and with sql.js on the
web, loaded through `import()` when a backup is written or opened. So sql.js
must be absent from the native bundle, and on the web it must sit in a chunk
of its own — never in the entry bundle every visit loads:

```bash
strings /tmp/sc-ios/_expo/static/js/ios/*.hbc | grep -c sql-wasm     # must print 0
find /tmp/sc-ios -name '*.wasm'                                      # must print nothing
grep -l sql-wasm /tmp/sc-web/_expo/static/js/web/entry-*.js          # must print nothing
grep -l sql-wasm /tmp/sc-web/_expo/static/js/web/*.js                # must print one other chunk
find /tmp/sc-web -name '*.wasm'                                      # the one sql.js file, fetched only by that chunk
```

`"sql-wasm-browser.wasm"` is a string literal in sql.js's browser build — the
one the package's `browser` condition picks on the web — so it survives
minification, and the `sql-wasm` greps above match it. The chunk is
`sql-js-web-*.js`; the `.wasm` sits under `assets/node_modules/sql.js/dist/`.
If the build ever falls back to `sql-asm.js`, grep for `sql-asm` instead. A web page that loads WebAssembly needs `'wasm-unsafe-eval'` in its
Content-Security-Policy — and nothing more than that.

## No secret in the database

The tests dump every table and store and grep for passwords, PINs and tokens
(`test/secrets.test.ts`). On a device, check by hand after connecting a source:
a browser's IndexedDB (DevTools → Application) holds only refs in
`streaming-center` and ciphertext in `streaming-center-secrets`, and on the
simulator `sqlite3 …/SQLite/streaming-center.db .dump | grep <password>` prints
nothing (`docs/platforms/ios` has the path).

The same holds after a sync and after importing a backup: the passwords the
server holds in plain text, and the ones inside the file, must land in the
keychain only. No stream URL, token or MAC address may appear in a dump or a
log either.

## Boundaries — a deliberate violation must fail

`eslint.config.js` turns the composition-root rule (spec §15) into lint errors:

| Import | Allowed only in |
| --- | --- |
| `@sc/source-*`, `@sc/iptv-*`, `@sc/player-*` and `@sc/sync-*` | `src/composition/**` |
| `@sc/player-kit` — covered by `@sc/player-*` (Phase 7) | `src/composition/**` — screens get a player's view from the service graph |
| `@/persistence/*` (and relative `…/persistence/…`) | `src/composition/**` |
| `@/platform/*` (and relative `…/platform/…`) | `src/composition/**` |
| `@/composition/*` | `src/app/_layout.tsx` |
| `expo-local-authentication` | `src/platform/**` — everything else asks `OwnerCheck` |
| `@noble/*` | `src/platform/**` — cryptography is the platform's |
| `sql.js` | `src/persistence/backup/sql-js*.ts` — a backup's database, nothing else |
| `…/sql-js-web`, statically | nowhere — only `sql.web.ts`'s `import()`, which the rule does not see, so it stays a chunk of its own |

The rows marked with a phase are the target: add them to `eslint.config.js`
when the packages they name exist, in the same commit.

Do not trust them, prove them. Drop a throwaway file into `src/screens/` that
imports one of each — including a relative `../platform/clock` — and run
`npx eslint` on it. Every import must be an error. Delete the file.

## Hermes rules

iOS and Android run Hermes, which lacks `Array.prototype.toSorted`,
`Object.groupBy`, `crypto.randomUUID` and `Uint8Array.prototype.toBase64` /
`fromBase64`, and may lack `structuredClone`, `Promise.withResolvers` and
`Intl.RelativeTimeFormat`. Tests run on Node and the
web runs V8, so nothing else notices until a phone throws. Lint rejects all of
them anywhere in `src/`; add `[1].toSorted()` to the throwaway file above and it
must fail too. The plugins repository's `test/engine.test.ts` scans its sources
for the same gaps.

## SQLite rules

Lint also rejects `withTransactionAsync` and `withExclusiveTransactionAsync`
anywhere in `src/`. The first folds other statements into the transaction; the
second runs on a second connection with foreign keys, and so cascades, off.
Transactions go through `LocalDatabase.transaction()`. A call such as
`db.withTransactionAsync(async () => {})` in the throwaway file must fail.

## Why web gets its own bundle

Web is a first-class target and breaks independently of native:

- It renders through react-native-web with Tamagui's web reset
  (`@tamagui/core/reset.css`, imported in `src/app/_layout.tsx`). Without the
  reset, browser defaults such as button padding break switches and buttons.
- The tab bar is a different component on web (`app-tabs.web.tsx`).
- `web.output` is `"single"`: one `index.html`, no pre-rendering.
- Its storage, its crypto and its backup engine are all web-only files.

An iOS bundle passing tells you nothing about web.

## Cross-repository check

If you changed anything in `../streaming_center_plugins`, verify there too —
nothing enforces consistency across the repositories:

```bash
cd ../streaming_center_plugins && npm run typecheck && npm test
```

After a change to the account contract, run the sync repository's tests as
well: `go test ./...` there, and `(cd harness && npm test)` from Phase 6's
S4, which drives the real `sync/custom-server` plugin against the real
PocketBase binary.

## Current state — read this before trusting a failure

**Phase 6 — the code is on the new architecture.** The checks marked with a
phase apply once that phase has built what they check; the rest apply today.

- Storage is **real**: SQLite and the keychain on native, IndexedDB and
  encrypted secrets on the web. Data persists between runs, so a flow that
  expects a first launch needs a fresh start (`docs/getting-started`).
- The web build refuses to start on plain `http` from a network address; use
  `localhost`.
- Phones run a **development build**. A failure that looks like code that did
  not change is usually a stale build: rebuild after anything native changed.
- `npm test` covers the database, every migration, the credential stores and
  the services — the account's flows and two devices on one fake server
  included — not screens. Screens are proven by driving the app on each
  platform (`sc-run`). The real account plugin against the real PocketBase is
  `../streaming_center_sync`'s harness, from Phase 6's S4.
- The built-in player's engine is in the build, and nothing opens it yet.
  The backup file, its import and export and backup targets are in place; the
  only backup target with a role is the dev-only mock.
- `expo-doctor` reports "multiple copies" of React, React Native and
  expo-video: it sees the plugins repository's own, which Metro blocks and the
  app never uses (`docs/plugins`). A bundle's source maps are the real check.
- Tamagui 2.7.7 logs a dev-only "`AlertDialogContent` requires a description"
  warning on web even though the dialog is described — its check runs before
  the portal mounts. Confirm with the DOM (`aria-describedby` resolves) rather
  than silencing it.
