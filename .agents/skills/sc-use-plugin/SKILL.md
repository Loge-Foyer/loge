---
name: sc-use-plugin
description: Wire a Streaming Center plugin from the plugins repository into the app — the file dependency, Metro watch folders, registration at the composition root, and branching on effective capabilities. Use when connecting, registering or debugging a plugin inside the app.
---

# Using a plugin in the app

Plugins live in a **separate repository** (`../streaming_center_plugins`), so
npm workspaces cannot reach them. This is the fiddliest seam in the project.

## 1. Depend on it

```jsonc
// package.json
"dependencies": {
  "@sc/api": "file:../streaming_center_plugins/api",
  "@sc/plugin-jellyfin": "file:../streaming_center_plugins/plugins/jellyfin"
}
```

## 2. Let Metro see it

```js
// metro.config.js
const path = require('path');
config.watchFolders = [path.resolve(__dirname, '../streaming_center_plugins')];
```

Without the watch folder, Metro resolves the package but will not rebuild when
you edit it, and the failure looks like a cache bug.

## 3. Register it at the composition root — one line

The composition root is **the only place** allowed to import a concrete plugin.
Screens and services resolve what they need from injected dependencies.

If a screen imports `@sc/plugin-jellyfin`, the architecture has already failed.

## 4. Branch on effective capabilities, never declared

This is the rule most easily got wrong.

A plugin **declares** what it can do, in its manifest. The user **enables** what
it may do, per connection. The app must read the intersection:

```
effective = declared ∩ enabled
```

Branching on declared alone calls features the user switched off — for a sync
role, that means pushing viewing state to a server they never asked to sync
with. Every sync toggle defaults to off for exactly this reason.

## 5. One plugin, one or two roles

A plugin is defined by the service, not the job. `@sc/plugin-jellyfin` carries
both a media role and a sync role. Enabling one must never enable the other.

Do not look for `@sc/plugin-jellyfin-sync`. It does not exist and should not.

## Verifying it actually resolves

`tsc` is not enough — it reads the path mapping and is satisfied. Metro
resolution across a repository boundary (symlinks, duplicate React copies,
hoisting) only fails in a real bundle:

```bash
npx expo export --platform ios --output-dir /tmp/sc-ios
```

If you changed the plugin itself, typecheck there too:

```bash
cd ../streaming_center_plugins && npm run typecheck
```

## Current state

**No plugin is wired up yet, and none exists to wire.** Every plugin package is
an empty `export {}`, including `@sc/api`. The dependency block above is the
target shape, not something already in `package.json`.

`api` has to be implemented before any of this is real.
