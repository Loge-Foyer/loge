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

**The plugins:**

- `jellyfin.test.ts` — the plugin against a fake HTTP client
  (`support/fake-http.ts`) answering with recorded 12.x payloads
  (`fixtures/jellyfin.ts`). It covers:
  - the sign-in header and the device id
  - single-flight sign-in, one re-login, and no retry of a refused password
  - local-only on mobile data and timeouts
  - query parameters, and library scoping
  - paging across libraries with no duplicates or gaps
  - mapping every item type
  - artwork addresses
- `mock.test.ts` — the catalogue is deterministic and honours sort, libraries,
  paging and latency.
- `manifests.test.ts` — the conformance check. Every manifest is sound, every
  plugin that declares a media capability implements its members, media
  servers stay media-only, and ids are unique. It is the one file allowed to
  import every plugin.

**The fake context** (`fakeContext()`) gives a plugin an in-memory session,
credentials, a network the test can switch, a client identity and a clock whose
`sleep` returns at once. Tests can therefore check every retry and latency path
without waiting.

Tests never live in `api/src` or `plugins/*/src`. `api` imports nothing, and a
test file there would import vitest.
