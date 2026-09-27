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

iCloud serves Drive files *and* can be the device's account. That is one package
declaring two roles — not `icloud` plus `icloud-sync`. Same for Google.

A **media server** (Jellyfin, Emby, Plex) is media-only: it is the master of what
its users watched, and the app reads and writes that through the *media* role.
Never give one a sync role.

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

   import { createProvider } from './provider';

   export const plugin: Plugin = {
     manifest: {
       id: pluginId('<id>'),
       displayName: '…',
       description: 'One sentence for the plugin list.',
       media: { contentKinds: ['movies', 'shows'], capabilities: ['browse'] },
       connectionFields: [
         { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
         { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
         { key: 'password', label: 'Password', type: 'password' },
       ],
       settings: [],
     },
     // Only once the role is implemented; until then, leave it out and declare no capability.
     media: { connect: async (target, context) => createProvider(target, context) },
   };
   ```

   `createProvider(target, context)` returns a `ConnectedMediaProvider`. It
   reaches the host only through `context`:

   - `http` for requests
   - `session` for a token
   - `credentials` for passwords
   - `network`, `client` and `clock`

   `api/` and `plugins/` have no host globals: the compiler refuses `fetch`,
   `URL`, `console` and timers.

   A role you do not declare is absent, and the app never asks for it.
   `contentKinds` is what the source brings — `movies`, `shows`, `anime`,
   `videos`, `files`; the app decides where each appears. `connectionFields`
   are shared by every role (one connection, one endpoint, one set of
   credentials), and the Settings screen renders them — never hard-code a form
   in the app.

3. **Declare capabilities honestly.** They are not documentation — application
   code branches on them. Listing `search` while `search()` throws turns every
   query into a `sourceError`; leaving it out means the method is never called.
   Declare a capability in the same change that implements it. The conformance
   test fails a declared capability whose members
   (`MEDIA_CAPABILITY_MEMBERS`) are missing.

   Also, for media:

   - Order `listItems` pages exactly by `compareItems(query.sort)`.
   - Sign in once for concurrent callers.
   - Never retry a refused login.

4. **Leave the sync role to the account.** A new connection starts with its
   sync role off; only choosing it as the device's account switches it on.
   Connecting a server for media must never make it the place profiles go —
   that independence is the only reason merging media and sync into one
   package was safe. A sync capability needs no toggle (signing in is the
   opt-in), so declare exactly what the account can hold.

5. **Map at the boundary.** Remote payloads become domain types *inside* this
   package. No external type may appear in a return value. Adapter-only data
   goes in provider-scoped metadata nothing else reads.

6. **Route secrets through the injected credential store.** A secret is a
   `password` connection field; the app stores it behind an opaque
   `credentialsRef`. `settings` is a plain database column and cannot hold a
   `password` field at all. Artwork needing auth carries a `headersRef`, never
   an inline header.

7. **Normalize errors** to `AppError` with a known code and a retry hint
   (`backoff`, `network-change`, `never`). A raw HTTP or transport error reaching
   the UI is a bug.

8. **Add it to `test/manifests.test.ts`**, the conformance check, and test the
   role against `fakeHttp` / `fakeContext` from `test/support/` with recorded
   payloads in `test/fixtures/`.

9. **Register it** in the app's composition root —
   `streaming_center_app/src/composition/plugins.ts`, one line.

## If it has a sync role

```ts
import { syncCursor, type SyncRole } from '@sc/api';

export const sync: SyncRole = {
  connect: async (target, context) => ({
    connectionId: target.connectionId,
    getStatus: async () => ({ accountName: '…' }),          // reach the account, sign in once
    pull: async (cursor) => ({ kind: 'changes', changes: [], cursor: syncCursor('…'), more: false }),
    push: async (changes) => ({ accepted: [] }),            // a prefix, each durably stored
    dispose: async () => {},
  }),
};
```

- **`push` must be idempotent.** It may see the same change twice after a crash
  or a rejected batch. Store it once, keyed by its id, and return the IDs you
  **accepted**; the engine advances its checkpoint only across the accepted
  prefix and retries the rest verbatim. End the prefix at the first change
  `isSyncChange()` refuses.
- **`pull` must be resumable and complete.** Return an opaque cursor, and the
  whole log in your order — the caller's own changes included. Answer `reset`
  when you lost data, `expired` when a cursor was compacted away.
- **Never resolve conflicts.** The app resolves them from your log's order.
- **Never overstate what you can carry.** The engine filters the change journal
  by your declared capabilities. Claim support you lack and it hands you changes
  you drop *and advances the checkpoint past them* — silent data loss.
- **A password travels only as the app sealed it.** To carry connections'
  passwords, declare `sealedPasswords` and implement `vaultKey()`: the key,
  derived on the device through `context.crypto`, that the app seals with. You
  never see another connection's password, and the key never reaches the
  server.
- **A `verifyOwner` you offer must really verify the account's owner**: Forgot
  PIN trusts it. If it takes a password, name the fields in `sync.ownerProof`;
  it receives them typed again, never the saved ones.
- **A 401 ends the session.** Do not sign in again with the saved password by
  yourself; the user signs in again. A refused sign-in is never retried.
- **Creating an account from the app** is `createAccount(fields)` with the
  extra fields in `sync.signUp`, and **`signOut()`** ends this device's session
  where the account can. Both are optional.

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

`api` holds the manifest vocabulary, the media contract (`MediaRole`,
`MediaItem`, `AppError`, `HttpClient`), the sync contract (`SyncRole`,
`SyncChange`, `isSyncChange`, sealed passwords, owner proofs, sign-up) and the
host's crypto port (`PluginCrypto`, `isKdfParams`). `plugins/jellyfin` is the
reference implementation of a media role, and `plugins/mock/src/sync.ts` a
minimal sync role; read them before writing another.
