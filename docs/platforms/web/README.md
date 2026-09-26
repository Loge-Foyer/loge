# Web

Running and deploying the web target.

```bash
npm run web
npx expo export --platform web --output-dir dist
```

- **A single-page app.** `web.output` is `"single"`: nothing is worth
  pre-rendering — what a visitor sees depends on this browser's profiles — and
  it avoids a whole class of hydration problems. A static host must serve
  `index.html` for every path.
- **Storage** will be IndexedDB, not SQLite. Because of that, the web build
  needs no WebAssembly configuration and no `Cross-Origin-Embedder-Policy` /
  `Cross-Origin-Opener-Policy` headers.
- **Secrets** will be encrypted in IndexedDB under a non-extractable WebCrypto
  key. That is weaker than a keychain — any script running on the page could
  use the key — so the deployed page needs a strict Content-Security-Policy.
- **Tamagui's reset** (`@tamagui/core/reset.css`) is imported by the root
  layout; the web build looks wrong without it.
- **Tabs** are a top navigation bar (`src/components/app-tabs.web.tsx`), not
  the native tab bar. There is no pull to refresh in a browser, so Media has a
  Refresh button beside Customize.

## Reaching a media server from a browser

- **CORS.** The browser sends the source's requests itself, so the server must
  allow the page's origin. Jellyfin answers `Access-Control-Allow-Origin: *` and
  allows the `Authorization` header by default; other servers may need
  configuring.
- **Mixed content.** A page served over `https` cannot call an `http` server on
  the local network; the browser blocks it before any request leaves. Serve the
  app over `http` on the same network, or put the server behind `https`.
- **No mobile data.** A browser only reports online or offline, never the kind
  of network, so a local-only source is never skipped on the web — it is tried,
  and if it cannot be reached it waits for the network to change.
- **Unbound `fetch`.** A browser throws "Illegal invocation" when `fetch` runs
  with any other `this`. The HTTP client calls it unbound, and a test holds it
  to that.
