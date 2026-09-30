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

Two IndexedDB databases, and no `Cross-Origin-*` headers from whatever serves
the page:

- **`streaming-center`** — the account, its profiles, connections and
  preferences, device settings, the change journal. The same schema as SQLite
  on a phone, with the cascades done by the repositories.
- **`streaming-center-secrets`** — passwords, PINs, session tokens and the
  backup key, as AES-GCM ciphertext under a key the page can use but never read
  out. Each value is sealed with its ref, so it cannot be moved under another
  one.

This is weaker than a keychain: any script running on the page can use the
key, so a deployed page needs a strict Content-Security-Policy.

**WebAssembly, only for backups.** The data never lives in SQLite compiled to
WebAssembly. Writing or opening a backup file loads sql.js — its own chunk
(`sql-js-web-*.js`), fetched through `import()` — and its `.wasm`, an asset
Metro serves (`metro.config.js`) at an absolute `/assets/…` path that
expo-asset resolves, so a deep route finds it too. It builds the file in
memory, and lets it go. Lint allows sql.js in `persistence/backup/sql-js*.ts`
alone, and no static import of the chunk anywhere. So the CSP allows `'wasm-unsafe-eval'`, for
sql.js, and nothing more.

A browser may clear a site's storage when space runs low. The app asks for
persistent storage (`navigator.storage.persist()`), which the browser may grant
or refuse. Safari deletes a site's storage after seven days without a visit,
unless the site is added to the Home Screen. An exported backup is the way to
keep an account that lives only in a browser.

**Offline**, the page itself has to load first: there is no service worker, so
a browser with no network at all cannot open the app. With the page loaded — or
served from `localhost` — a server that cannot be reached is replaced by what
was saved from it, as on a phone.

**Several tabs** share one database. A tab does not see another's changes
until it reloads. When a tab opens a newer version of the app, the older tabs
close their connection so its upgrade can run, then ask to be reloaded.

## The account in a browser

- **One tab syncs at a time.** A run holds the `streaming-center-sync` Web
  Lock, so two tabs never push the same journal or reconcile at once. Another
  tab still sees the changes only once it reloads.
- **Forgot PIN needs a server account.** A browser cannot ask for the device's
  owner, so on a local account a PIN stays until it is typed.
- **The backup file** goes out as a download and comes in through a file input
  (Phase 6).
- **The development account forgets on reload.** The mock keeps its pretend
  server in the page's memory. After a reload the next run finds it empty and
  puts back what this browser holds, as for a server restored from an old
  backup. Nothing local is lost.

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

## IPTV is not on the web, yet

IPTV plugins leave `web` out of their platforms, so a browser does not list
them, and an IPTV connection on the account shows there as "not available on
this device". Most portals send no CORS headers, and a Stalker portal wants a
`Cookie` header, which a browser forbids a page to set. IPTV on the web waits
for an opt-in proxy on your own server (a later phase), which would see the
stream traffic, so it would be off by default.

## Players in a browser

The built-in player (Phase 7) is a `<video>` element. Safari plays HLS
natively; elsewhere hls.js is loaded, lazily, when an HLS stream is played.
mpegts.js joins it in Phase 8, for MPEG-TS live streams. KSPlayer, mpv and VLC
have no web build.

A `<video>` element cannot send headers, so a source that needs one puts its
token in the stream's URL instead — Jellyfin as `api_key`. That is one reason a
playback descriptor never leaves memory, and redaction covers URLs.
