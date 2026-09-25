---
name: sc-use-plugin
description: Wire a Streaming Center plugin from the plugins repository into the app — the file dependency, the Metro watch folder, the registration line at the composition root, and branching on effective roles. Use when connecting, registering or debugging a plugin inside the app.
---

# Using a plugin in the app

Plugins live in a **separate repository** (`../streaming_center_plugins`), so
npm workspaces cannot reach them. This is the fiddliest seam in the project.

## 0. Install the plugins repository first

```bash
cd ../streaming_center_plugins && npm install
```

Plugin files resolve `@sc/api` from that repository's `node_modules`. Skip it
and both `tsc` and Metro fail to resolve `@sc/api` from inside a plugin.

## 1. Depend on it

```jsonc
// package.json — edit by hand; `npx expo install` has nothing to pick for file: deps
"dependencies": {
  "@sc/api": "file:../streaming_center_plugins/api",
  "@sc/plugin-jellyfin": "file:../streaming_center_plugins/plugins/jellyfin"
}
```

Then `npm install`. npm links the folders and never looks inside link targets
outside the project, so it never reaches for a registry.

Every plugin declares `@sc/api` as a **peer** dependency: the app supplies the
one copy, so a `PluginId` from a plugin and one from the app are the same type.
`npm ls --all` still prints `UNMET DEPENDENCY @sc/api@*` under each linked
plugin — npm does not resolve dependencies of links outside the root. That line
is cosmetic; `npm ls @sc/api` should show the single top-level link.

## 2. Let Metro see it

```js
// metro.config.js — the whole of it
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../streaming_center_plugins')];
```

Metro only serves files under the project root or a watch folder. Nothing else
is needed: babel-preset-expo imports its runtime helpers by absolute path, so
plugin files never have to resolve `@babel/runtime` themselves (checked in dev
and production bundles for iOS and web).

## 3. Register it — one line

`src/composition/plugins.ts` is **the only place** that imports a concrete
plugin, and lint enforces it. Every plugin exports the same name:

```ts
import { plugin as jellyfin } from '@sc/plugin-jellyfin';
// …and one entry in the `plugins` array
```

The catalogue validates every manifest at startup (`validateManifest`): it
throws in development and leaves the plugin out in production. Nothing else in
the app changes — Settings renders the new plugin's form from its manifest.

## 4. Branch on effective roles, never declared

A plugin **declares** roles, content kinds and capabilities. The user
**enables** roles and toggles per connection. The app reads the result of
`effectiveRoles(manifest, connection)` from `@sc/api` — the sources service
does this for every screen:

```
effective = declared ∩ switched on   (a missing switch is off)
```

Branching on declared alone calls features the user switched off — for a sync
role, pushing viewing state to a server they never asked to sync with. Every
sync toggle defaults to off for exactly this reason.

## 5. Installed per device, configured once or per profile

A plugin does nothing until it is **installed** (enabled) on the device. Its
connections are the device's and shared by every profile — unless its
"Configure per profile" switch is on, in which case each profile has its own.
Both sets are kept; the switch only picks the live one.

## 6. One plugin, one or two roles

A plugin is defined by the service, not the job. `@sc/plugin-jellyfin` carries
both a media and a sync role. Enabling one must never enable the other.
Do not look for `@sc/plugin-jellyfin-sync`. It does not exist and should not.

## Verifying it actually resolves

`tsc` is not enough. Metro resolution across a repository boundary (symlinks,
duplicate copies, hoisting) only fails in a real bundle:

```bash
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web --source-maps
```

In the web source map, each `streaming_center_plugins/api/src/*` file must
appear exactly once — two copies would mean two brands and two vocabularies.

## Current state

All eleven plugins are linked and registered (`mock` in development builds
only). They export manifests only: no role is implemented, so the app lists
them, installs them and configures connections, but nothing talks to a service.
