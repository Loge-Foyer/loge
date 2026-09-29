# Development

Testing, verification, debugging and release.

## Before anything counts as done

```bash
npm run android           # after a native change: rebuilds the development client (npm run ios likewise)
npx expo start            # once — generates the typed-route types
npm run typecheck         # the app, then the tests: two TypeScript programs
npm run lint              # includes the import-boundary, Hermes and SQLite rules
npm test                  # vitest: the database, the credential stores, the services
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

The exports are not optional. They are the only proof that Metro resolves the
plugins across the repository boundary, and that each platform's bundle holds
only its own storage — SQLite and the keychain for iOS, IndexedDB for the web —
and, once backups exist, that sql.js stays out of the native bundles and in a
chunk of its own on the web. The `sc-verify` skill has the full pass, with the
checks for each.

After changing the plugins repository, run `npm run typecheck && npm test`
there as well. After a change to the account contract, run the sync
repository's tests too: `npm test` today, and from Phase 6 `go test ./...` and
its harness, which drives the real `sync/custom-server` plugin against the real
PocketBase binary.

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
  including a table rebuild and a database from a newer version. From Phase 6,
  a v2 database with rows migrates through v3 and v4 on both engines, keeping
  every profile, connection and password ref.
- **The credential stores** — the keychain adapter against a SecureStore
  look-alike that refuses keys the way the real one does, and the web store on
  Node's WebCrypto.
- **The host's crypto** — HKDF against RFC 5869's vectors, and AES-GCM opening
  what Node sealed and the other way round, on Node's WebCrypto. Until Phase 6
  also the web's PBKDF2 against RFC 7914's vectors; the native key-derivation
  module cannot run on Node, and is checked against the same vector on the
  emulator.
- **The services** — connections and per-profile values, profiles and PINs and
  the profile limit, secrets and what happens to them, session binding, the
  provider pool, merged rows, grid pages and Continue Watching, the home
  layout, and the catalogue by platform, category and kind. The writes that
  span rows run on both engines.
- **The account and its sync** — two devices, each a whole service graph on
  its own database, share one fake PocketBase account (`test/support/sync.ts`),
  on every pair of engines: SQLite and SQLite, IndexedDB and IndexedDB, and one
  of each. The fake refuses writes, fails, loses an answer, forgets everything
  (a restore), throttles, refuses a sign-in, and changes its password. The
  suites prove:
  - edits, renames, deletes and PINs converge
  - a pending edit survives a read, and a remote delete of a profile or
    connection beats it
  - a refused batch is split, and a profile over the limit stays local
  - a lost answer converges on the next run, and a server that forgot
    everything gets every row back from the devices
  - passwords arrive in the keychain and never in a database dump, while the
    fake server holds them in plain text
  - a password changed elsewhere is refused once, then parked — never tried
    again
  - signing in replaces, signing up uploads, signing out keeps a local copy,
    and the owner check and Forgot PIN hold on both engines
  - a device-key fingerprint that no longer matches drops the pending journal
- **Backups** — a round trip on both engines, with sql.js in Node standing in
  for expo-sqlite; the passwords arrive in the keychain, never in a database
  dump. A wrong key, a tampered byte, a file over 64 MiB and a newer schema
  are refused, and a changed generation or etag asks rather than overwrites.

Until Phase 6 the fake account is a log server's. It can store part of a push,
expire a cursor, seal passwords and revoke a device, and the suites prove
joining an account and the sign-in rule too. Phase 6 replaces it.

The real account plugin meets the real server in the sync repository: its
harness from Phase 6, `test/plugin.test.ts` there today. The scheduler runs on
fake timers against a scripted engine. Choosing a player is a pure function in
`@sc/api`, tested there over a matrix of descriptors and profiles.

`test/support/services.ts` builds the service graph as the app wires it, and
stays in step with `composition/`. `test/support/engines.ts` opens a fresh
database per test. Two things there make mistakes fail loudly:

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
- **Your own server** logs every request, and PocketBase's dashboard
  (`http://localhost:8090/_/`) shows each account's records as the devices left
  them. That includes the sources' passwords, in plain text, which is why the
  dashboard stays private.
