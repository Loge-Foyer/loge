# Development

Testing, verification, debugging and release.

## Before anything counts as done

```bash
npx expo start            # once — generates the typed-route types
npm run typecheck         # the app, then the tests: two TypeScript programs
npm run lint              # includes the import-boundary, Hermes and SQLite rules
npm test                  # vitest: the database, the credential stores, the services
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

The exports are not optional: they are the only proof that Metro resolves the
plugins across the repository boundary, and that each platform's bundle holds
only its own storage — SQLite and the keychain for iOS, IndexedDB for the web.
After changing the plugins repository, run `npm run typecheck && npm test`
there as well. The `sc-verify` skill has the full pass.

Typechecking is two programs. `tsconfig.json` covers the app, which runs on
Hermes and never sees Node's types. `test/tsconfig.json` covers the tests,
which use `node:sqlite` and other Node modules.

## Tests

`npm test` runs vitest over `test/`. Only the device boundary is faked — the
clock, ids, the network, `fetch`, the keychain and a media plugin. Everything
else is real, including the database engine:

- **The database** — one contract suite, run on SQLite through `node:sqlite`
  and on IndexedDB through fake-indexeddb. It covers cascades, all-or-nothing
  transactions, the change journal, creation order, and updates that must not
  replace their children. Migrations and upgrades are tested separately,
  including a table rebuild and a database from a newer version.
- **The credential stores** — the keychain adapter against a SecureStore
  look-alike that refuses keys the way the real one does, and the web store on
  Node's WebCrypto.
- **The services** — connections and per-profile values, profiles and PINs,
  secrets and what happens to them, session binding, the provider pool, merged
  rows, grid pages and Continue Watching, the home layout. The writes that span
  rows run on both engines.

`test/support/services.ts` builds the service graph as the app wires it.
`test/support/engines.ts` opens a fresh database per test. Two things there
make mistakes fail loudly:

- A call to the database from inside one of its own transactions throws, where
  on SQLite it would hang.
- The fake keychain settles on a later macrotask, so a transaction that awaits
  it fails on IndexedDB, as it would in a browser.

Tests run on Node, which has built-ins Hermes does not. What passes here can
still throw on a phone — which is why lint rejects the known gaps in `src/` —
and screens are only proven by driving the app: see the `sc-run` skill.

## Debugging on a device

- **Android** prints JavaScript logs to logcat:
  `adb logcat -s ReactNativeJS`. The HTTP client's debug lines show every request
  a source makes, without query strings, headers or bodies.
- The web build logs to the browser console. A browser's `fetch` must be called
  unbound; the HTTP client does, and a test keeps it that way.
