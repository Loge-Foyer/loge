# Writing a plugin

One plugin, one job. First decide its category (`../categories/`): a source,
an IPTV provider, a player, or a place for the account. A service that does two
jobs becomes two plugins, one in each folder.

1. **Create the package** — `plugins/<category>/<name>/`.
   - Its `package.json` is named for the category: `@sc/source-<name>`,
     `@sc/iptv-<name>`, `@sc/player-<name>` or `@sc/sync-<name>`.
   - It has `"exports": "./src/index.ts"`, and `@sc/api` as a **peer**
     dependency: the app supplies the one copy, so the plugin and the app
     agree on every type.
   - A player adds `@sc/player-kit`, React and its engine as peers.
2. **Write the manifest** in `src/index.ts`, and export it as `plugin` (see
   `api/`). Its parts:
   - **`id`:** `'<category>/<name>'`.
   - **`category`:** the folder's.
   - **`platforms`:** where it really runs.
   - **Its category's one block:** `media`, `player`, `account` or `backup`.
   - **`connectionFields`:** what a connection needs. Mark account fields with
     `credential`, and give an address the `url` type.
3. **Implement the role** the block promises:
   - `media.connect(target, context)` → `ConnectedMediaProvider`
   - `player.create(context)` → `MediaPlayer`, with a `PlayerView`
   - `account.connect(target, context)` → `ConnectedAccount`
   - `backup.connect(target, context)` → `ConnectedBackupTarget`
4. **Declare capabilities as you implement them**, never ahead. See
   `capabilities/`.
5. **Add it to `test/manifests.test.ts`**, write its tests against a fake
   context, and run `npm test`.
6. **Register it in the app** — one line in `src/composition/plugins.ts`.

## Inside the media role — sources and IPTV

- **Use only the context.**
  - `context.http` for every request; `context.clock` for time and waiting.
  - `context.session` for anything you keep between launches, such as a
    token. The app scopes it to the connection and its credentials and drops
    it when they change.
  - `context.credentials.read()` for the password fields.
  - The compiler has no `fetch`, `URL`, `console` or timers to offer.
- **Connect without the network.** `connect()` builds a client. Sign in on the
  first call, **once**, shared by every caller (single-flight): a home screen
  starts several requests at the same moment.
- **Never retry a refused login.** Servers lock accounts after a few failures,
  and portals block a MAC address. Remember the refusal and rethrow it.
- **Map at the boundary.** Read payloads as `unknown`, check the fields you
  use, and return domain types only. Nothing shaped like the service leaves
  the package; the conformance of your mapping is what the fixtures test.
- **Order pages exactly by `compareItems(query.sort)`.** The app merges
  sources with the same function, and so can you, across your own libraries
  (`mergeSorted`). Cursors are yours: opaque strings the app hands back.
- **Throw `AppError` with a retry hint.**
  - `network-change` — waiting for another network is the only sensible retry,
    such as a home server seen from mobile data.
  - `backoff` — a server that is starting up or overloaded.
  - `never` — a wrong password, or a missing item.
  - `reason: 'local-network-only'` — only when you know the device is away
    from home: the network reports mobile data and the source is local-only. A
    local server that cannot be reached may simply be down, so it waits for
    another network without the reason; the app words the two differently.
  - A raw transport error reaching the app is a bug. Aborted requests are the
    exception, and are rethrown as they are.
- **Your code runs on Hermes** in the iOS and Android apps.
  - Hermes lacks `Array.prototype.toSorted`, `Object.groupBy`,
    `crypto.randomUUID` and `Uint8Array.prototype.toBase64`; they typecheck,
    then throw on a phone.
  - Copy, then sort — on an array you just made with `filter` or `map`,
    sorting in place is fine.
  - Turn bytes into text with `api`'s helpers (`encodeBase64Url`,
    `encodeUtf8`…).
  - `test/engine.test.ts` fails if a source uses one of these.
- **Artwork** is an `ImageRef` you build and later resolve synchronously into an
  address. If an image needs a header, return a `headersRef` and resolve it in
  `resolveHeaders` — never put a token in a URL.
- **What to play** (`getPlaybackDescriptor`) is for the engine the request
  describes: a server that transcodes reads the request's `PlayerProfile` and
  answers with what that engine can play. A descriptor's addresses can carry
  credentials, so keep them in memory: never in the session, never in a log.
- **Progress back** (`reportPlayback`, `setPlayed`, behind `watchStateWrite`)
  comes through the app's outbox, which may deliver a report twice after a
  lost answer: make both safe to repeat.

## Inside an IPTV plugin

Everything above, plus:

- **Live TV** comes through `listChannelGroups` and `listChannels`, behind
  `channels`, and `getGuide`, behind `epg`. Channels come in the provider's own
  order.
- **A provider's films and series** come through the ordinary browse members,
  as `movies` and `shows`. The app shows all of it on the TV tab.
- **A MAC address, or a portal's device id, is a secret.** Whoever has it has
  the subscription, so it is a `password` field: in the keychain, never in the
  database or a log. Never retry a portal that refused it.
- **So is a playlist address with the sign-in in it** — most M3U links from a
  provider carry a username and password in their query.
- **Links are short-lived.** A portal's `create_link` answer, or an Xtream
  address with the password in its path, belongs in a playback descriptor,
  made when playing and held in memory only.
- **Don't claim `web`** unless the service sends CORS headers and needs
  nothing a browser forbids, such as a `Cookie` header.

## Inside a player

- **Two parts, one package.**
  - `src/index.ts` exports the manifest and `player.create(context)`, which
    returns the framework-free `MediaPlayer`.
  - The view — the part that draws — is a `PlayerView` from `@sc/player-kit`,
    exported beside it.
  - Native code, when the engine needs it, is an Expo module in the package's
    own folder.
- **The engine is a peer.** A published engine — expo-video, hls.js — is a
  peer dependency with React and React Native: the app installs it, so
  autolinking builds it and there is one copy. This repository installs it
  too, as a development dependency, for the typecheck and the tests only.
- **The view finds its engine through the controller.** `create` keeps the
  engine behind the `MediaPlayer` it returns (a `WeakMap` in the package), and
  the view looks it up; given another player's controller, it throws.
- **Platforms are files.** `engine.ts` and `engine.web.ts`, `view.tsx` and
  `view.web.tsx`: Metro picks by platform, and `index.ts` imports `./engine`.
  Both files export the same names.
- **Load a web engine lazily.** Anything big that only some streams need —
  hls.js — comes through `import()`, so it is a chunk of its own.
- **The profile is the promise.** `player.profiles` says, per platform, which
  protocols, containers, codecs and subtitle formats the engine plays.
  `choosePlayer` trusts it, and a server that transcodes shapes its answer to
  it. State only what really plays.
- **Report through events.** State, position, tracks and errors go out as
  `PlayerEvent`s. An error is an `AppError`, never a silent stop.
  - Tell a state once, and tell a new listener the current one.
  - Follow what was asked for, not an engine's flag that lags behind it: a
    stream turns ready before it starts, and Media3 is not "playing" while it
    buffers. A screen must never flash a pause.
  - Ignore an engine's events until something is loaded.
- **Test the engine against a fake of it.** Node has no native module: the
  root `vitest.config.ts` aliases expo-video to `test/support/fake-expo-video.ts`,
  and a web engine takes its `<video>` and hls.js from its host
  (`WebEngineHost`), so a test hands it fakes (`test/support/fake-video.ts`).
- **Headers are resolved at load time** (`context.resolveHeaders`) and held in
  memory only.

## Inside an account — your own server

- **`pull` is everything.** Return every record of the account, deleted ones
  included, as `AccountRecord`s. The app reads the whole account on every
  sync, and a record left out reads as lost.
- **`push` is all or nothing.** Store the batch in one transaction, parents
  first, or store none of it and say which write stopped it:
  - `limit` — a profile over the server's maximum
  - `deleted` — a write to a profile or connection that is deleted
  - `invalid` — a malformed record
- **Deletes are soft.** A deleted record comes back with `deleted: true`, and
  a deleted profile or connection stays deleted.
- **Passwords travel in `secrets`**, in plain text, to your own server, for
  now. A name listed in `secretKeys` without a value keeps the stored one:
  a device that lacks a password never erases it.
- **Sign in once, and never again after a refusal by yourself.** When a
  session ends — it expired, or the password changed — sign in once with the
  saved password. A refusal is latched until the user acts, and a throttled
  sign-in is `backoff` with `too-many-attempts`.
- **An owner check checks the owner.** `verifyOwner(proof)` receives the
  fields `account.ownerProof` names, typed again; never compare against the
  saved password.
- **Creating an account** is `createAccount(fields, { firstProfile })`, with
  the fields `account.signUp` adds to the connection's own. Tried once, like a
  sign-in.
- **Store and return; never decide.** Conflicts are the app's.

## Inside a backup target

- **Bytes in, bytes out.** `write(name, bytes, ifMatch)`, `read`, `stat`,
  `list`. What the bytes hold, and their encryption, are the app's business.
- **Conditional writes, always.** With `ifMatch`, refuse with `SYNC_CONFLICT`
  when the file changed since that etag, so two devices never overwrite each
  other in silence.
- **Say where the file goes**, in `backup.location`, in words the user
  recognises: "iCloud Drive → Streaming Center".
