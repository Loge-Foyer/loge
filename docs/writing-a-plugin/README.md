# Writing a plugin

One plugin per service, whatever it does. A service that both serves media and
holds your state is one package with two roles, not two packages.

1. **Create the package** — `plugins/<id>/` with a `package.json` named
   `@sc/plugin-<id>`, `"exports": "./src/index.ts"`, and `@sc/api` as its only
   **peer** dependency: the app supplies the one copy, so the plugin and the app
   agree on every type.
2. **Write the manifest** in `src/index.ts` and export it as `plugin` (see
   `api/`). Say what the source brings (`contentKinds`) and what a connection
   needs (`connectionFields`), marking account fields with `credential`. Give
   an address the `url` type: the app uses a saved password only with the
   address and account it was saved for, and an address it recognises is a
   `url` field.
3. **Implement the role** you declare — for media, `media.connect(target,
   context)` returning a `ConnectedMediaProvider`; for sync,
   `sync.connect(target, context)` returning a
   `ConnectedUserStateSyncProvider`.
4. **Declare capabilities as you implement them**, never ahead. See
   `capabilities/`.
5. **Add it to `test/manifests.test.ts`**, write its tests against a fake
   context, and run `npm test`.
6. **Register it in the app** — one line in `src/composition/plugins.ts`.

## Inside the media role

- **Use only the context.**
  - `context.http` for every request; `context.clock` for time and waiting.
  - `context.session` for anything you keep between launches, such as a
    token. The app scopes it to the connection and its credentials and drops
    it when they change.
  - `context.credentials.read()` for the password fields.
  - The compiler has no `fetch`, `URL`, `console` or timers to offer.
- **Connect without the network.** `connect()` builds a client; sign in on the
  first call, **once**, shared by every caller (single-flight). A home screen
  starts several requests at the same moment.
- **Never retry a refused login.** Servers lock accounts after a few failures.
  Remember the refusal and rethrow it.
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
  - `reason: 'local-network-only'` only when you know the device is away from
    home — the network reports mobile data and the source is local-only. A local
    server that cannot be reached may simply be down, so it waits for another
    network without the reason; the app words the two differently.
  - A raw transport error reaching the app is a bug. Aborted requests are the
    exception, and are rethrown as they are.
- **Your code runs on Hermes** in the iOS and Android apps. Hermes lacks
  `Array.prototype.toSorted`, `Object.groupBy`, `crypto.randomUUID` and
  `Uint8Array.prototype.toBase64`; they typecheck, then throw on a phone. Copy,
  then sort — on an array you just made with `filter` or `map`, sorting in
  place is fine. Turn bytes into text with `api`'s helpers
  (`encodeBase64Url`, `encodeUtf8`…). `test/engine.test.ts` fails if a source
  uses one.
- **Artwork** is an `ImageRef` you build and later resolve synchronously into an
  address. If an image needs a header, return a `headersRef` and resolve it in
  `resolveHeaders` — never put a token in a URL.

## Inside the sync role

- **Store and return; never decide.** The app resolves conflicts from the order
  of your log. Keep changes in the order you stored them, and return them in
  that order — the caller's own included.
- **Deduplicate by change id.** The same change arrives again after a crash or
  a lost answer; store it once, and accept it again.
- **Answer only what you stored.** `accepted` is a prefix of the ids sent, each
  already durable. Confirming a change you then lose means it is never sent
  again.
- **Cursors are yours**, opaque and durable. When you cannot continue from one,
  say why: `reset` when you lost data, `expired` when you compacted it away.
- **Check what you are given** with `isSyncChange()`, and end the accepted
  prefix at the first change you refuse.
- **Declare what you can hold, and nothing more.** The app hands you every
  change of a kind you declare, and counts it delivered once you accept it.
- **Keys go through `context.crypto`.** An account whose server must never
  read the household's passwords derives its keys on the device — PBKDF2 with
  parameters `isKdfParams` accepts, checked before anything is derived — and
  hands the app the vault key (`vaultKey`, promised by `sealedPasswords`). The
  app seals; you never see another connection's password.
- **An owner check checks the owner.** `verifyOwner(proof)` receives the
  fields `sync.ownerProof` names, typed again; never compare against the saved
  password. A wrong proof is `UNAUTHORIZED`, throttled adds
  `too-many-attempts`, and an account that no longer knows this device says
  `signed-out`, so the device's own check answers.
- **A 401 ends the session.** Once the account says it no longer knows this
  device — revoked, or deleted — do not sign in again with the saved password
  by yourself: the user signs in again.
- **Creating an account** is `createAccount(fields)`, with the fields
  `sync.signUp` adds to the connection's own. Tried once, like a sign-in.
