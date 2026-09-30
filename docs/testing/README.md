# Testing

```bash
npm run typecheck
npm test
```

Vitest, run over `test/` at the repository root.

`npm run typecheck` is three programs:

1. **`api` and the non-player plugins** compile with `lib: ["esnext"]` and no
   types at all, so a host global cannot creep in.
2. **Player plugins and `player-kit`** (`tsconfig.players.json`) get React
   Native's types, and the DOM's for the browser's `<video>`, because an engine
   draws.
3. **The tests** are a program of their own (`test/tsconfig.json`), with
   Node's types, because the fake context's crypto runs on `node:crypto`.

**The rules in `api`:**

- `category.test.ts` — qualified ids (`sources/jellyfin`), reading a category
  back, what is account-wide and device-wide, and `runsOn`.
- `validate.test.ts` — every `validateManifest` rule: libraries, credentials,
  the account's owner proof and sign-up fields, and, for a manifest that names
  its category, the id's shape, one block per category, platforms and player
  profiles.
- `account.test.ts` — `isAccountRecord` over `api/fixtures/account-records.json`,
  every valid record accepted and every invalid one refused. The sync server's
  Go tests read the same file, so both sides judge a record alike. Also the
  size limit, `recordKey`, and `recordId` against the file's vectors, which the
  server derives too.
- `player.test.ts` — `canPlay`, `missingFor` and `choosePlayer`: the preferred
  player when it can, the others in order, sources best first, and "none".
- `effective.test.ts` — the effective-capabilities rule: connections off,
  toggles off, defaults, ungated capabilities.
- `per-profile.test.ts` — which keys each mode keeps per profile, resolved
  values, and "set up".
- `compare.test.ts` — the one ordering rule and `mergeSorted`.
- `errors.test.ts` — retry hints.
- `bytes.test.ts` — base64, base64url and UTF-8 against known vectors and
  Node's own, both ways, and every malformed input refused.

**The plugins:**

- `jellyfin.test.ts` — the plugin against a fake HTTP client
  (`support/fake-http.ts`) answering with recorded 12.x payloads
  (`fixtures/jellyfin.ts`). It covers:
  - the sign-in header and the device id
  - single-flight sign-in, one re-login, and no retry of a refused password
  - local-only on mobile data (no request, the `local-network-only` reason),
    an unreachable local server (waits for another network, no reason), and
    timeouts
  - query parameters, and library scoping
  - paging across libraries with no duplicates or gaps
  - mapping every item type
  - artwork addresses
- `iptv-mock.test.ts` — the mock portal's lineup is the same every run and
  pages by group; its guide has no gaps and agrees with itself in any window,
  and its setting switches `epg` off; its films and series come in
  `compareItems` order; a channel plays over HLS, while one in every group only
  offers MPEG-TS, which AVPlayer's profile cannot play; another connection's
  key gets nothing.
- `mock.test.ts` and `mock-account.test.ts` — the catalogue is deterministic
  and honours sort, libraries, paging and latency; the pretend account keeps
  your server's rules — all or nothing, the limit, deleted stays deleted,
  kept passwords — and the pretend backup target refuses a stale etag.
- `custom-server.test.ts` — your own server's plugin against a fake of
  PocketBase's routes and rules (`support/fake-pocketbase.ts`): one sign-in
  shared by every caller, a refusal latched, a newer session taken, one more
  sign-in when a session ends, throttling that waits; paged reads, batches and
  the refusal each maps to; sign-up with its invite; the owner check.
- `manifests.test.ts` — the conformance check. It is the one file allowed to
  import every plugin. It checks, per category:
  - every manifest is sound, runs somewhere, and ids are unique
  - every declared media capability has its members
  - a `player` block has its role
  - an `account` block has `ACCOUNT_MEMBERS`, plus `verifyOwner` for an
    `ownerProof` and `createAccount` for a `signUp`
  - a `backup` block has `BACKUP_MEMBERS`
  - media servers stay sources
- `engine.test.ts` — no source in `api/` or any plugin uses a built-in that
  Hermes lacks (`Array.prototype.toSorted`, `Object.groupBy`,
  `crypto.randomUUID`, `Uint8Array.prototype.toBase64`, `fromBase64`). Plugins
  run on Hermes in the iOS and Android apps; the compiler accepts these, so
  without this check a plugin passes everything here and throws on a phone.

**Quick crypto** (`quickCrypto()`) is the same port with a key derivation that
takes no time and counts itself, for tests that sign in many times; it refuses
weak parameters as the app's does.

**The fake context** (`fakeContext()`) gives a plugin:

- an in-memory session and credentials
- a network the test can switch
- a client identity
- a clock whose `sleep` returns at once
- the host's crypto on `node:crypto` (`support/node-crypto.ts`) — the same
  algorithms the app runs

So tests can check every retry and latency path without waiting, and a route
can answer with headers.

Tests never live in `api/src` or `plugins/**/src`. `api` imports nothing, and a
test file there would import vitest.
