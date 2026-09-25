# Development

Testing, verification, debugging and release.

## Before anything counts as done

```bash
npx expo start            # once — generates the typed-route types
npm run typecheck
npm run lint              # includes the import-boundary rules
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

The exports are not optional: they are the only proof that Metro resolves the
plugins across the repository boundary. After changing the plugins repository,
run `npm run typecheck && npm test` there as well.

## Tests

The app has no tests yet; `@sc/api`'s rules are covered by vitest in the plugins
repository. Until app tests exist, drive the app itself — see the `sc-run`
skill for seeded data, deep links and screenshots on every platform.
