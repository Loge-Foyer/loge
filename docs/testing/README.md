# Testing

```bash
npm test
```

Vitest, run over `test/` at the repository root.

**The rules in `api`:**

- `effective.test.ts` — the effective-roles rule: roles off, toggles off,
  defaults, ungated capabilities, undeclared roles.
- `validate.test.ts` — every `validateManifest` rule, including `libraries` and
  `credential`.
- `per-profile.test.ts` — which keys each mode keeps per profile, resolved
  values, and "set up".
- `compare.test.ts` — the one ordering rule and `mergeSorted`.
- `errors.test.ts` — retry hints.
- `sync.test.ts` — the sync wire: `isSyncChange` for every entity and for bad
  shapes, `syncKey`, what each entity needs an account to carry, and
  `defaultRoles`, which never switches sync on.

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
- `manifests.test.ts` — the conformance check. Every manifest is sound, every
  plugin that declares a media capability implements its members, a plugin
  that declares sync capabilities has a sync role with every provider member,
  media servers stay media-only, and ids are unique. It is the one file allowed
  to import every plugin.
- `engine.test.ts` — no source in `api/` or `plugins/` uses a built-in that
  Hermes lacks (`Array.prototype.toSorted`, `Object.groupBy`,
  `crypto.randomUUID`). Plugins run on Hermes in the iOS and Android apps; the
  compiler and Node both accept these, so without this check a plugin passes
  everything here and throws on a phone.

**The fake context** (`fakeContext()`) gives a plugin an in-memory session,
credentials, a network the test can switch, a client identity and a clock whose
`sleep` returns at once. Tests can therefore check every retry and latency path
without waiting.

Tests never live in `api/src` or `plugins/*/src`. `api` imports nothing, and a
test file there would import vitest.
