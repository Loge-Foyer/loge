# Development

Testing, verification, debugging and release.

## Before anything counts as done

```bash
npx expo start            # once — generates the typed-route types
npm run typecheck
npm run lint              # includes the import-boundary and Hermes rules
npm test                  # vitest: the service layer
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

The exports are not optional: they are the only proof that Metro resolves the
plugins across the repository boundary. After changing the plugins repository,
run `npm run typecheck && npm test` there as well. The `sc-verify` skill has the
full pass, including the check that no development secret reaches a production
bundle.

## Tests

`npm test` runs vitest over `test/`: connections and per-profile values, session
binding, the provider pool, merged rows, grid pages and Continue Watching, the
home layout, the HTTP client, the draft helpers, boot, and the Jellyfin start
script. `test/support/services.ts` builds the real service graph on in-memory
stores, with fakes for the clock, the network, `fetch` and a media plugin, so a
test exercises services exactly as the app wires them.

Tests run on Node, which has built-ins Hermes does not. What passes here can
still throw on a phone — which is why lint rejects the known gaps in `src/` —
and screens are only proven by driving the app: see the `sc-run` skill.

## Debugging on a device

- **Android** prints JavaScript logs to logcat:
  `adb logcat -s ReactNativeJS`. The HTTP client's debug lines show every request
  a source makes, without query strings, headers or bodies.
- The web build logs to the browser console. A browser's `fetch` must be called
  unbound; the HTTP client does, and a test keeps it that way.
