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
  the native tab bar.
