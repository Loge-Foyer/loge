# Getting started

```
api/                  @sc/api — the vocabulary; depends on nothing
  fixtures/           records every side must judge alike
player-kit/           @sc/player-kit — the React half of the player contract (Phase 7)
plugins/
  sources/<name>/     media from a server, a share or a drive
  iptv/<name>/        live TV, and a provider's films and series
  players/<name>/     engines that play
  sync/<name>/        where the account lives, or its backup
test/                 vitest: the api rules, each implemented plugin against a fake context, conformance
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

A player plugin may carry native code — an Expo module in its own folder,
beside `src/` — which the app's development build compiles in. Nothing else
here has any.
