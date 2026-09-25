# Testing

```bash
npm test
```

Vitest, run over `test/` at the repository root:

- `effective.test.ts` — the effective-roles rule: roles off, toggles off,
  defaults, ungated capabilities, undeclared roles.
- `validate.test.ts` — every `validateManifest` rule.
- `manifests.test.ts` — the conformance check: every plugin's manifest is
  sound, declares no capability ahead of its implementation, and has a unique
  id. It is the one file allowed to import every plugin.

Tests never live in `api/src`: `api` imports nothing, and a test file there
would import vitest.

The `mock` plugin carries both roles and a deliberately partial set of
capabilities with a toggle for each gateable one, so tests — and the app — can
flip them and confirm that effective capabilities are honoured rather than
declared ones.
