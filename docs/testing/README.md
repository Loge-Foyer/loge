# Testing

```bash
npm run typecheck
npm test
```

Vitest, run over `test/` at the repository root.

`npm run typecheck` is two programs. `api` and the plugins compile with
`lib: ["esnext"]` and no types at all, so a host global cannot creep in. The
tests are a program of their own (`test/tsconfig.json`) with Node's types,
because the fake context's crypto runs on `node:crypto`.

**The rules in `api`:**

- `effective.test.ts` — the effective-roles rule: roles off, toggles off,
  defaults, ungated capabilities, undeclared roles.
- `validate.test.ts` — every `validateManifest` rule, including `libraries` and
  `credential`.
- `per-profile.test.ts` — which keys each mode keeps per profile, resolved
  values, and "set up".
- `compare.test.ts` — the one ordering rule and `mergeSorted`.
- `errors.test.ts` — retry hints.
- `bytes.test.ts` — base64, base64url and UTF-8 against known vectors and
  Node's own, both ways, and every malformed input refused.
- `sync.test.ts` — the sync wire: `isSyncChange` for every entity and for bad
  shapes, sealed values and the size limit, `syncKey`, what each entity needs
  an account to carry, and `defaultRoles`, which never switches sync on.
- `validate.test.ts` also covers an account's `ownerProof` and `signUp`, and
  `isKdfParams`: nothing weaker than the floor, nothing heavier than a phone
  can derive.

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
- `mock.test.ts` — the catalogue is deterministic and honours sort, libraries,
  paging and latency.
- `mock-sync.test.ts` — the pretend account: a change stored once however often
  it is sent, the accepted prefix, the caller's own changes returned, paging,
  resuming, one account per endpoint, `reset` for a cursor it did not give out,
  and the household seed.
- `custom-server.test.ts` — the account on your own server, against a fake of
  the server's routes (`support/fake-sync-server.ts`), which knows only that a
  proof hashes to what it stored: the address reduced to its base, a proof and
  never the password, the session reused and sign-in shared, weak parameters
  refused before deriving, a refused sign-in never tried again, a 401 leaving a
  tombstone that outlives a relaunch, pushes split at 4 MiB with the prefix
  across them, the vault key the same on two devices, the owner check's four
  answers, creating an account and its refusals, signing out, and the error
  table.
- `manifests.test.ts` — the conformance check. Every manifest is sound, every
  plugin that declares a media capability implements its members, a plugin
  that declares sync capabilities has a sync role with every provider member
  and every member its capabilities promise (`vaultKey` for
  `sealedPasswords`, `verifyOwner` for an `ownerProof`, `createAccount` for
  `signUp`), media servers stay media-only, and ids are unique. It is the one
  file allowed to import every plugin.
- `engine.test.ts` — no source in `api/` or `plugins/` uses a built-in that
  Hermes lacks (`Array.prototype.toSorted`, `Object.groupBy`,
  `crypto.randomUUID`, `Uint8Array.prototype.toBase64`, `fromBase64`). Plugins
  run on Hermes in the iOS and Android apps; the compiler accepts these, so
  without this check a plugin passes everything here and throws on a phone.

**Quick crypto** (`quickCrypto()`) is the same port with a key derivation that
takes no time and counts itself, for tests that sign in many times; it refuses
weak parameters as the app's does. One test derives for real.

**The fake context** (`fakeContext()`) gives a plugin an in-memory session,
credentials, a network the test can switch, a client identity, a clock whose
`sleep` returns at once, and the host's crypto on `node:crypto`
(`support/node-crypto.ts`) — the same algorithms the app runs, so a value
sealed in a test opens on a phone. Tests can therefore check every retry and
latency path without waiting. A route can answer with headers.

Tests never live in `api/src` or `plugins/*/src`. `api` imports nothing, and a
test file there would import vitest.
