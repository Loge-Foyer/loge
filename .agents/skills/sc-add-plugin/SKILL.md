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
   `"exports": "./src/index.ts"`, depending only on `@sc/api`), `src/index.ts`
   and a `README.md` stating its roles.

2. **Write the manifest.** Declare only the roles the service actually has:

   ```ts
   {
     id, displayName,
     media?: { capabilities, connectionFields },
     sync?:  { capabilities, connectionFields },
     settings: [...]
   }
   ```

   A role you do not declare is absent, and the app never asks for it.

3. **Declare capabilities honestly.** They are not documentation — application
   code branches on them. Declaring `search: true` while `search()` throws turns
   every query into a `sourceError`. Declaring `false` means the method is never
   called.

4. **Give every sync capability a toggle, defaulting to `false`.** Connecting a
   server for media must never start pushing viewing state to it. This
   independence is the only reason merging media and sync into one package was
   safe.

5. **Map at the boundary.** Remote payloads become domain types *inside* this
   package. No external type may appear in a return value. Adapter-only data
   goes in provider-scoped metadata nothing else reads.

6. **Route secrets through the injected credential store.** The connection holds
   an opaque `credentialsRef`. `settings` is a plain database column — never put
   a token there. Artwork needing auth carries a `headersRef`, never an inline
   header.

7. **Normalize errors** to a typed application error with a known code. A raw
   HTTP error reaching the UI is a bug.

8. **Register it** in the app's composition root — one line.

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
```

## Current state

`api` is **empty** — the contracts are specified in the architecture document
but not written as code. Implement `api` before any plugin; nothing else can be
built correctly until the vocabulary exists.
