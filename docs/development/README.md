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

The exports are not optional. They are the only proof that Metro bundles one
copy of every package the adapters share with the app, that each platform's
bundle holds only its own storage — SQLite and the keychain for iOS, IndexedDB
for the web — and that sql.js stays out of the native bundles and sits in a
chunk of its own on the web. The `sc-verify` skill has the full pass, with the
checks for each.

`npm run typecheck` and `npm test` cover the adapters as well as `src/`: five
TypeScript programs and two vitest projects, from this one package. After a
change to the account contract, run the sync repository's tests too —
`go test ./...` and its harness, which drives the real `sync/custom-server`
adapter against the real PocketBase binary.

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
  including a table rebuild and a database from a newer version: every step on
  SQLite, and on IndexedDB a v1 database through v4 one version at a time,
  keeping every profile, connection and password ref, and queueing every
  secret of Phase 4's account.
- **The credential stores** — the keychain adapter against a SecureStore
  look-alike that refuses keys the way the real one does, and the web store on
  Node's WebCrypto.
- **The host's crypto** — SHA-256 against the standard's vectors and the
  record ids the shared fixtures give, HKDF against RFC 5869's, and AES-GCM
  opening what Node sealed and the other way round, on Node's WebCrypto.
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
  - a refused write gives way — a profile over the limit stays local, a write
    to something deleted goes with its children, an invalid one is left out
    and not sent again on every run
  - a lost answer converges on the next run, and a server that forgot
    everything gets every row back from the devices
  - passwords arrive in the keychain and never in a database dump, while the
    fake server holds them in plain text
  - a password changed elsewhere is refused once, then parked — never tried
    again
  - signing in replaces, signing up uploads, signing out keeps a local copy,
    and the owner check and Forgot PIN hold on both engines
  - a device-key fingerprint that no longer matches drops the pending journal
    and the session
- **Backups** (`test/backup.test.ts`) — the key and how it is typed, the
  container, the database inside, and a round trip on both engines, with
  sql.js in Node standing in for expo-sqlite: the passwords arrive in the
  keychain, never in a database dump. Another key, a mistyped one, a changed
  byte, a stranger, a file over 64 MiB, a newer format or schema and a row the
  contract refuses are all refused before anything changes; the key is shown
  only to the owner; a device on your server signs out before it imports.
- **Backup targets** (`test/backup-targets.test.ts`), two devices on one fake
  target (`support/backup-target.ts`): a save and a save over it; a file
  another device changed stands in conflict instead of being overwritten, and
  each answer — theirs, mine, both — does what it says; saving after a change
  and on going to the background; an account on your server saving over its
  file. `test/players.test.ts`: players per platform, on and off, which plays
  first, and nothing journaled.

The real account adapter meets the real server in the sync repository's
harness. The scheduler runs on fake timers against a scripted engine. Choosing
a player is a pure function in `@sc/api`, tested there over a matrix of
descriptors and profiles.

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
