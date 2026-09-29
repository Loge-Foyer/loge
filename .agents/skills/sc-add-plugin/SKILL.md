---
name: sc-add-plugin
description: Create a new Streaming Center plugin in its category folder — a source, an IPTV provider, a player, or a sync plugin (your own server, or a backup target) — with a manifest, its one block, capabilities and settings. Use when adding support for a new service or engine like Plex, a Stalker portal, mpv or OneDrive.
---

# Adding a plugin

Read `docs/categories/`, `docs/writing-a-plugin/` and
`../.claude/streaming-center-architecture.md` section 7 first. This is the
working checklist.

**Transitional:** until Phase 6 regroups the folders, existing plugins sit at
`plugins/<id>/` with Phase 4's roles. A plugin added before then still goes
where the others are, with the category and platforms declared, so it moves
with them.

## The test of success

One new folder under `plugins/<category>/`, and one line registering it in the
app. If you find yourself editing the app's screens, services or database
schema, the abstraction in `api` is wrong — fix that instead of working around
it.

## One job per plugin

First decide the category (`sc-plugin-categories` if in doubt):

| It… | Category | Block |
| --- | --- | --- |
| brings films, series, anime, videos or files | `sources` | `media` |
| brings live TV, and maybe a provider's films and series | `iptv` | `media`, with `live` |
| plays | `players` | `player` |
| keeps the account, or its backup | `sync` | `account` or `backup` |

A service with two jobs is **two plugins**: `sources/google-drive` and
`sync/google-drive`, each with its own sign-in. A **media server** (Jellyfin,
Emby, Plex) is a source and nothing else — it masters its users' watch status
through the media role.

## Checklist

1. **Create `plugins/<category>/<name>/`** with:
   - a `package.json`: `@sc/<source|iptv|player|sync>-<name>`,
     `"exports": "./src/index.ts"`, and `@sc/api` as a **peer** dependency, so
     the host supplies the one instance and branded IDs match. A player adds
     `@sc/player-kit`, `react`, `react-native` and its engine as peers.
   - `src/index.ts`
   - a `README.md` stating its category, what it brings or does, where it
     runs, and its status

2. **Write the manifest** and export it as `plugin`. Declare the category's
   **one** block, and where it really runs:

   ```ts
   import { pluginId, type Plugin } from '@sc/api';

   import { createProvider } from './provider';

   export const plugin: Plugin = {
     manifest: {
       id: pluginId('sources/<name>'),
       category: 'sources',
       platforms: ['ios', 'android', 'web'],
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

   - **A player** declares `player: { profiles: { ios: {…}, android: {…} } }`
     and exports `player: { create }` plus a `PlayerView`.
   - **An account** declares `account: { ownerProof?, signUp? }` and exports
     `account: { connect }`.
   - **A backup target** declares `backup: { location }` and exports
     `backup: { connect }`.

   The provider reaches the host only through `context`: `http` for requests,
   `session` for a token, `credentials` for passwords, and `network`,
   `client`, `clock` and `crypto`. `api/` and every non-player plugin have no
   host globals: the compiler refuses `fetch`, `URL`, `console` and timers.

3. **Declare capabilities honestly.** They are not documentation — application
   code branches on them.
   - Listing `search` while `search()` throws turns every query into a
     `sourceError`; leaving it out means the method is never called.
   - Declare a capability in the same change that implements it.
   - The conformance test fails a declared capability whose members
     (`MEDIA_CAPABILITY_MEMBERS`) are missing, and a block without its role.

   Also, for a source or IPTV plugin:
   - Order `listItems` pages exactly by `compareItems(query.sort)`.
   - Sign in once for concurrent callers.
   - Never retry a refused login.
   - Keep playback addresses in memory only.

4. **Say where it runs.** `platforms` is honest.
   - A plugin that needs iCloud's container is `['ios']`.
   - A portal without CORS headers, or one that needs a `Cookie` header, is not
     `web`.
   - A player's profiles name only platforms in `platforms`.

5. **Map at the boundary.** Remote payloads become domain types *inside* this
   package. No external type may appear in a return value. Adapter-only data
   goes in provider-scoped metadata nothing else reads.

6. **Route secrets through the injected credential store.** A secret is a
   `password` connection field; the app stores it behind an opaque
   `credentialsRef`. Anything that signs in on its own is a password field,
   whatever it looks like — a portal's MAC address or device id, a playlist
   address with the sign-in in it.
   - `settings` is a plain database column and cannot hold a `password` field
     at all.
   - Artwork or a stream needing auth carries a `headersRef`, never an inline
     header.

7. **Normalize errors** to `AppError` with a known code and a retry hint
   (`backoff`, `network-change`, `never`). A raw HTTP or transport error reaching
   the UI is a bug.

8. **Add it to `test/manifests.test.ts`**, the conformance check, and test the
   role against `fakeHttp` / `fakeContext` from `test/support/` with recorded
   payloads in `test/fixtures/`.

9. **Register it** in the app's composition root —
   `streaming_center_app/src/composition/plugins.ts`, one line — and add the
   `file:` dependency by its folder path.

## If it is your own server's account role

```ts
import type { AccountRole } from '@sc/api';

export const account: AccountRole = {
  connect: async (target, context) => ({
    connectionId: target.connectionId,
    info: async () => ({ serverVersion: '…', maxProfiles: 10, signUp: 'invite' }), // no sign-in
    status: async () => ({ accountId: '…', accountName: '…' }),                    // sign in, once
    pull: async () => ({ records: [] }),                                           // every record
    push: async (records) => ({ kind: 'stored' }),                                 // all or nothing
    dispose: async () => {},
  }),
};
```

- **`pull` is complete.** Every record of the account, deleted ones included.
  A record left out reads as lost.
- **`push` is all or nothing.** Store the batch in one transaction, or none of
  it, and name the write that stopped it: `limit`, `deleted` or `invalid`.
- **Deletes are soft**, and a deleted profile or connection stays deleted.
- **Passwords travel in `secrets`**, in plain text, to your own server. A name
  listed without a value keeps the stored one.
- **Never resolve conflicts.** The app does.
- **A session that ends gets one sign-in** with the saved password. A refusal
  is latched until the user acts; a throttled one is `backoff` with
  `too-many-attempts`.
- **`verifyOwner(proof)`** checks the `ownerProof` fields, typed again —
  never the saved ones. **`createAccount(fields, { firstProfile })`** takes
  the `signUp` fields, tried once.

## If it is a backup target

`stat`, `read`, `list`, and `write(name, bytes, ifMatch)`, which refuses with
`SYNC_CONFLICT` when the file changed since that etag. Bytes only: the file's
format and encryption are the app's.

## If it is a player

- **A `MediaPlayer`:** framework-free, reporting `PlayerEvent`s.
- **A `PlayerView`**, from `@sc/player-kit`, that draws it.
- **A profile per platform** that states only what the engine really plays.
- **Native code,** if any: an Expo module in the package's own folder,
  compiled into the app's development build.

## Boundaries lint will not catch yet

- A non-player plugin may import `@sc/api` and nothing else from this project,
  and no framework — not React, not Expo.
- A player may add `@sc/player-kit`, React, React Native and its engine, and
  nothing from another plugin.
- **Plugins never import each other.** If two need the same client, that
  client becomes its own package.

## Verify

```bash
npm install
npm run typecheck
npm test
```

## Current state

**`api` holds the target vocabulary:**

- categories, platforms and qualified ids
- the media contract, with live TV and playback members
- the player contract and `choosePlayer`
- the account role (`AccountRecord`, `isAccountRecord`, with fixtures shared
  with the server)
- the backup role

Phase 4's roles and log-based sync role stay until Phase 6.

**Read these before writing another:**

- `plugins/jellyfin` — the reference implementation of a media role
- `plugins/mock` — a partial one, on purpose
- `plugins/custom-server` — Phase 4's account
