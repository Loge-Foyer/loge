# Architecture

Layers, the composition root, state ownership, and the rules that keep plugins
from leaking into screens. The full reasoning is in
`../../.claude/streaming-center-architecture.md`.

## Layers

```
src/
  app/          routes only (expo-router); each file renders a screen
  screens/      screen bodies — kept apart so TV layouts can be new screens
  components/   the design system, on Tamagui; takes domain types only
  hooks/        React bindings: query hooks, the session gate
  services/     business logic, no React; ports.ts declares what they need
  persistence/  repository implementations (in memory today)
  platform/     device boundary: credential store, ids, clock
  composition/  builds the service graph
```

Dependencies point inward. Services depend only on the interfaces in
`services/ports.ts` — never on a repository implementation or a platform module.
Screens and hooks reach services through `useServices()`, never through
`composition/`. Only `src/app/_layout.tsx` mounts the composition root, and only
`composition/` chooses implementations. Lint enforces all of it.

## The composition root

`composition/services.ts` wires the graph; `composition/provider.tsx` builds it
**once per JavaScript runtime**, not once per mount. The router may remount the
root layout — after a deep link, or the browser's back button — and that must
never produce a second graph with empty state.

## The session gate

`services/session.ts` owns a single gate: `starting`, `needs-first-user`,
`needs-user-selection`, `needs-user-unlock`, `ready` or `failed`. The first
decision after launch is the pure function in `services/boot.ts`. Every root
route sits behind exactly one `Stack.Protected` guard on that gate, so when the
gate moves, the guards do the navigating.

The tab navigator is keyed by the active profile: switching profiles remounts
every tab, so nothing of the previous profile survives on screen.

## Where a source comes from

For the active profile, `services/sources.ts` takes every plugin installed on
the device, then its device connections — or, if the plugin is configured per
profile, the profile's own — and asks `@sc/api`'s `effectiveRoles` what each
connection may actually do. The tabs only ever see that result.

## State ownership

| State | Lives in |
| --- | --- |
| Profiles, connections, device settings | repositories (in memory today; SQLite / IndexedDB next) |
| Secrets and PINs | the credential store (in memory today; keychain / encrypted IndexedDB next) |
| Reads for screens | TanStack Query, every key prefixed by `device` or by the active profile |
| The session gate | the session service, read with `useSyncExternalStore` |
