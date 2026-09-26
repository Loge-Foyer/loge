# Writing a plugin

One plugin per service, whatever it does. A service that both serves media and
holds your state is one package with two roles, not two packages.

1. **Create the package** — `plugins/<id>/` with a `package.json` named
   `@sc/plugin-<id>`, `"exports": "./src/index.ts"`, and `@sc/api` as its only
   **peer** dependency: the app supplies the one copy, so the plugin and the app
   agree on every type.
2. **Write the manifest** in `src/index.ts` and export it as `plugin` (see
   `api/`). Say what the source brings (`contentKinds`) and what a connection
   needs (`connectionFields`), marking account fields with `credential`.
3. **Implement the role** you declare — for media, `media.connect(target,
   context)` returning a `ConnectedMediaProvider`.
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
  - A raw transport error reaching the app is a bug. Aborted requests are the
    exception, and are rethrown as they are.
- **Artwork** is an `ImageRef` you build and later resolve synchronously into an
  address. If an image needs a header, return a `headersRef` and resolve it in
  `resolveHeaders` — never put a token in a URL.
