# Publishing

Nothing is published. Every package here is private, TypeScript source with no
build step, and the app consumes it as a workspace.

- **Workspaces, not links.** The app's `package.json` declares
  `adapters/api`, `adapters/player-kit` and `adapters/{sources,iptv,players,sync}/*`
  as `workspaces`, and depends on each by name at `"*"`. `npm install` at the
  app's root links them into `node_modules/@sc/`; there is nothing else to do.

  They were a repository of their own until Phase 9, consumed through `file:`
  dependencies with a Metro watch folder and a block list. That is gone, along
  with the second `node_modules` and the duplicate-native-package hazard that
  came with it.
- **Package names** follow the category: `@sc/source-<name>`,
  `@sc/iptv-<name>`, `@sc/player-<name>`, `@sc/sync-<name>`, plus `@sc/api`
  and `@sc/player-kit`.
- **One copy of `api`.** Every adapter takes `@sc/api` as a peer dependency,
  so the app supplies the one instance and branded ids agree. The same holds
  for a player's React, React Native and engine.
- **`"exports": "./src/index.ts"`.** The app's bundler and TypeScript both read
  the source directly, so a change here needs no build and no version bump.
- **Native code** in a player adapter is picked up by the app's development
  build through Expo's autolinking, from the workspace link — the one native
  thing built from outside `node_modules`. A native change means building the
  app again.
