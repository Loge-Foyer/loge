# Web

Running and deploying the web target.

```bash
npm run web
npx expo export --platform web --output-dir dist
```

- **A single-page app.** `web.output` is `"single"`. Nothing is worth
  pre-rendering, because what a visitor sees depends on this browser's
  profiles, and it avoids a whole class of hydration problems. A static host
  must serve `index.html` for every path.
- **Tamagui's reset** (`@tamagui/core/reset.css`) is imported by the root
  layout; the web build looks wrong without it.
- **Tabs** are a top navigation bar (`src/components/app-tabs.web.tsx`), not
  the native tab bar. There is no pull to refresh in a browser, so Media has a
  Refresh button beside Customize.

## A secure page

The app runs only on a secure page: `https`, or `localhost`. Its secrets are
encrypted with WebCrypto, which browsers offer nowhere else. Opened over plain
`http` from a network address, the app refuses to start and says why.

Being on a secure page concerns the app's own page, never a source. Nothing in
the app requires a server to use TLS.

## Storage

Two IndexedDB databases, and no WebAssembly or `Cross-Origin-*` headers from
whatever serves the page:

- **`streaming-center`** — profiles, connections, preferences, the change
  journal. The same schema as SQLite on a phone, with the cascades done by the
  repositories.
- **`streaming-center-secrets`** — passwords, PINs and session tokens, as
  AES-GCM ciphertext under a key the page can use but never read out. Each
  value is sealed with its ref, so it cannot be moved under another one.

This is weaker than a keychain: any script running on the page can use the
key, so a deployed page needs a strict Content-Security-Policy.

A browser may clear a site's storage when space runs low. The app asks for
persistent storage (`navigator.storage.persist()`), which the browser may grant
or refuse. Safari deletes a site's storage after seven days without a visit,
unless the site is added to the Home Screen.

**Several tabs** share one database. A tab does not see another's changes
until it reloads. When a tab opens a newer version of the app, the older tabs
close their connection so its upgrade can run, then ask to be reloaded.

## Reaching a media server from a browser

- **CORS.** The browser sends the source's requests itself, so the server must
  allow the page's origin. Jellyfin answers `Access-Control-Allow-Origin: *` and
  allows the `Authorization` header by default; other servers may need
  configuring.
- **Mixed content.** A page served over `https` cannot call an `http` server;
  the browser blocks it before any request leaves, whatever the page's
  certificate. From `localhost` an `http` server on your network works as it
  is. An `https` page can reach one only when you allow insecure content for
  the site (Chrome: Site settings → Insecure content), or when the server
  itself is on `https`.
- **No mobile data.** A browser only reports online or offline, never the kind
  of network, so a local-only source is never skipped on the web — it is tried,
  and if it cannot be reached it waits for the network to change.
- **Unbound `fetch`.** A browser throws "Illegal invocation" when `fetch` runs
  with any other `this`. The HTTP client calls it unbound, and a test holds it
  to that.
