---
name: sc-use-plugin
description: Wire a Streaming Center plugin from the plugins repository into the app — the file dependency, the Metro watch folder, the registration line at the composition root, per-profile connection values, effective roles on resolved values, and how the media and sync roles are called. Use when connecting, registering or debugging a plugin inside the app.
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
`effectiveRoles(manifest, { roles, settings })` from `@sc/api`, computed on the
settings the active profile runs the connection with — the sources service does
this for every screen:

```
effective = declared ∩ switched on   (a missing switch is off)
```

Branching on declared alone calls features the user switched off — for
`offlineMetadata`, keeping titles and artwork on a device whose owner said not
to. The sync role is on for one connection only, the device's account, and only
the account service switches it; signing in is the opt-in, so the account
carries what its plugin declares, less any toggle the user switched off.

## 5. Installed per device, configured per connection

A plugin does nothing until it is **installed** (enabled) on the device. Its
connections are the device's. Each connection's `perProfile` mode decides what
a profile keeps for itself — `none`, `credentials` (password fields and fields
marked `credential: true`), or `all` — and those values live in rows the profile
owns. `resolveValues` merges them over the shared ones; `services/sources.ts`
gives each connection a standing per profile: **live**, **pending** (its own
values are not filled in: Media offers "Finish setting up"), or **off** (the
profile does not use it, and is never asked).

Under `all`, two profiles can run the same connection with different settings,
so always read capabilities from the resolved source, never from the connection
alone.

## 6. One plugin, one or two roles

A plugin is defined by the service, not the job: one plugin per service,
declaring a media role, a sync role, or both. Enabling one must never enable the
other. Jellyfin, Emby and Plex are **media-only** — they master their own watch
status, which travels through the media role's watch-state capabilities. Do not
look for `@sc/plugin-jellyfin-sync`; it does not exist and should not.

## 7. How a media role is called

`plugin.media.connect(target, context)` is called by `services/media/pool.ts`
and nothing else. The target is the resolved values for one credential scope;
the context (`services/plugin-context.ts`) carries every host service a plugin
may use — HTTP, the scope's
credentials, its session token, the network kind, a client identity and a
clock — because plugins have no host globals. A declared capability means the
provider implements its member (`browse` → `listItems`, `getItem`,
`getChildren`; `libraries` → `getLibraries`; `watchStateRead` → `getResume`;
`remoteImages` → `resolveImage`); the plugins repository's conformance test
enforces it, and the media service reports a missing one as `INVALID_STATE`.

Screens never call a provider. They read `useHomeRowQueries`, `useGrid`,
`useItem` and friends (`src/hooks/use-media.ts`), which go through the media
service: merged across sources, failures returned as `sourceErrors`, parking
and retry handled there.

## 8. How a sync role is called

`plugin.sync.connect(target, context)` is called by `services/sync/provider.ts`
and nothing else: for the connection that is the device's account, and once,
outside any pool, to try a sign-in before anything is saved. Its session is kept
apart from the media role's (`session:{id}:account`). The engine
(`services/sync/engine.ts`) pulls, applies and pushes; screens read
`useSyncStatus` and `useAccount` and never call a provider. A plugin declaring
sync capabilities implements `pull`, `push`, `getStatus` and `dispose` — the
plugins repository's conformance test enforces it — and `verifyOwner` when the
account can vouch for its owner, which Forgot PIN uses.

What the manifest declares decides the rest, with no plugin named in the app:

- **`sealedPasswords`** — the engine asks `vaultKey()` once per run and seals
  and opens connections' passwords itself (`services/sync/sealed.ts`); the
  plugin never sees another connection's password.
- **`sync.ownerProof`** — the owner check asks for those password fields again,
  in `OwnerProofForm`, and hands them to `verifyOwner(proof)`.
- **`sync.signUp`** — "New here? Create an account" adds those fields, and the
  try calls `createAccount(fields)` instead of `getStatus()`.
- **`signOut()`** — called once, for at most five seconds, when the device
  signs out or switches.
- **`context.crypto`** — the host's PBKDF2, HKDF and AES-GCM
  (`src/platform/plugin-crypto.ts`): a plugin derives its keys through it,
  never in JavaScript of its own.

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

All ten plugins are linked and registered (`mock` in development builds only).
Jellyfin and the mock implement the media role — browse, libraries, watch
status read, and (Jellyfin) remote images and offline metadata. Two implement
the sync role: the mock, a pretend account held in memory, keyed by its
endpoint; and your own server (`custom-server`), with sealed passwords, the
password as owner proof, and sign-up with an invite. The rest export manifests
only: the app lists them, installs them and configures connections, and says
plainly that they cannot list titles, or be an account, yet.
