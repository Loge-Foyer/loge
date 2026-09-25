---
name: sc-add-plugin
description: Create a new Streaming Center plugin — a media source, a sync target, or both — with a manifest, roles, capabilities and settings. Use when adding support for a new service like Jellyfin, Plex, iCloud or a sync backend.
---

# Adding a plugin

Read `docs/writing-a-plugin/` and `../.claude/streaming-center-architecture.md`
section 7 first. This is the working checklist.

## The test of success

One new folder under `plugins/`, and one line registering it in the app. If you
find yourself editing the app's screens, services or database schema, the
abstraction in `api` is wrong — fix that instead of working around it.

## One plugin per service, not per job

A plugin is defined by **the service it talks to**, not by what it does with it.

Jellyfin serves a library *and* remembers what you watched. That is one package
declaring two roles — not `jellyfin` plus `jellyfin-sync`. Same for Emby, Plex,
iCloud and Google.

If the service you are adding already has a folder, you are adding a **role**,
not a plugin. Use the `sc-plugin-roles` skill instead.

## Checklist

1. **Create `plugins/<id>/`** with `package.json` (`@sc/plugin-<id>`,
   `"exports": "./src/index.ts"`, `@sc/api` as its only **peer** dependency —
   the host supplies the one instance, so branded IDs match), `src/index.ts`
   and a `README.md` stating its roles and what it brings.

2. **Write the manifest** and export it as `plugin`. Declare only the roles the
   service actually has:

   ```ts
   import { pluginId, type Plugin } from '@sc/api';

   export const plugin: Plugin = {
     manifest: {
       id: pluginId('<id>'),
       displayName: '…',
       description: 'One sentence for the plugin list.',
       media: { contentKinds: ['movies', 'shows'], capabilities: [] },
       sync: { capabilities: [] },
       connectionFields: [
         { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
         { key: 'password', label: 'Password', type: 'password' },
       ],
       settings: [],
     },
   };
   ```

   A role you do not declare is absent, and the app never asks for it.
   `contentKinds` is what the source brings — `movies`, `shows`, `anime`,
   `videos`, `files`; the app decides where each appears. `connectionFields`
   are shared by every role (one connection, one endpoint, one set of
   credentials), and the Settings screen renders them — never hard-code a form
   in the app.

3. **Declare capabilities honestly.** They are not documentation — application
   code branches on them. Listing `search` while `search()` throws turns every
   query into a `sourceError`; leaving it out means the method is never called.
   Declare a capability in the same change that implements it — until then the
   list stays empty.

4. **Give every sync capability a toggle, defaulting to `false`.** Connecting a
   server for media must never start pushing viewing state to it. This
   independence is the only reason merging media and sync into one package was
   safe.

5. **Map at the boundary.** Remote payloads become domain types *inside* this
   package. No external type may appear in a return value. Adapter-only data
   goes in provider-scoped metadata nothing else reads.

6. **Route secrets through the injected credential store.** A secret is a
   `password` connection field; the app stores it behind an opaque
   `credentialsRef`. `settings` is a plain database column and cannot hold a
   `password` field at all. Artwork needing auth carries a `headersRef`, never
   an inline header.

7. **Normalize errors** to a typed application error with a known code. A raw
   HTTP error reaching the UI is a bug.

8. **Add it to `test/manifests.test.ts`**, the conformance check that runs
   `validateManifest` over every plugin.

9. **Register it** in the app's composition root —
   `streaming_center_app/src/composition/plugins.ts`, one line.

## If it has a sync role

- **`push` must be idempotent.** It may see the same change twice after a crash
  or a rejected batch. Return the IDs you **accepted**; the engine advances its
  checkpoint only across the accepted prefix and retries the rest verbatim.
- **`pull` must be resumable.** Return an opaque cursor, stored per connection.
- **Never resolve conflicts.** The app's resolver owns that.
- **Never overstate what you can carry.** The engine filters the change journal
  by your declared capabilities. Claim support you lack and it hands you changes
  you drop *and advances the checkpoint past them* — silent data loss.

## Boundaries lint will not catch yet

- A plugin may import `@sc/api` and nothing else from this project.
- No framework imports — not React, not Expo.
- **Plugins never import each other.** If two need the same HTTP client, that
  client becomes its own package.

## Verify

```bash
npm install
npm run typecheck
npm test
```

## Current state

`api` holds the manifest vocabulary — IDs, content kinds, fields, capabilities,
connections, effective roles and `validateManifest`. The role contracts
(`MediaRole`, `SyncRole`, `MediaItem`) are not written yet, so every real plugin
is a manifest with empty capability lists.
