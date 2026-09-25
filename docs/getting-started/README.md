# Getting started

```
api/        @sc/api — the vocabulary; depends on nothing
plugins/    one package per service
test/       vitest: the effective-roles rule, manifest validation, conformance
docs/
```

```bash
npm install         # npm workspaces: links api and every plugin
npm run typecheck
npm test
```

Every package is TypeScript source with no build step (`"exports":
"./src/index.ts"`). The app consumes them through `file:` dependencies; run
`npm install` here first, because plugin files resolve `@sc/api` from this
repository's `node_modules`.
