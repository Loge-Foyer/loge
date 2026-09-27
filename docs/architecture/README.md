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
  persistence/  the local database: SQLite (native) and IndexedDB (web)
  platform/     device boundary: credentials, HTTP, network, identity, clock, logging,
                the device owner's check, app activity, the run lock
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
never produce a second graph, which would open the database a second time. In
development the graph is kept on `globalThis` for the same reason: Fast
Refresh re-runs the provider's module after an edit, so a changed service
needs a reload. The same file wires TanStack Query's focus manager to
`AppState`, so returning to the app refreshes what is stale.

`composition/storage.ts` builds the native storage — SQLite and two keychain
services — and `storage.web.ts` the web's: IndexedDB, and secrets encrypted in
IndexedDB. Metro picks the file by platform, so neither side ships the other's
code. The databases open on first use; launching first deletes secrets a crash
left queued, then makes the boot decision, and a storage failure lands on the
boot screen's "could not start". Then the sync scheduler starts.

## The local database

Services reach it through `LocalDatabase` (`services/ports.ts`). Called
directly, a repository method is a transaction of its own; several writes that
must land together go through `transaction(work)`, and `work` awaits nothing but
the repositories it is given. Every change to profiles, preferences and
connections appends a change-journal entry in the same transaction. The rules,
and why each exists, are in `docs/data`.

## The session gate

`services/session.ts` owns a single gate: `starting`, `needs-first-user`,
`needs-user-selection`, `needs-user-unlock`, `ready` or `failed`. The first
decision after launch is the pure function in `services/boot.ts`. Every root
route sits behind exactly one `Stack.Protected` guard on that gate, so when the
gate moves, the guards do the navigating.

Everything a signed-in profile can reach lives in the `(app)` group: the tabs,
and the pages pushed over them — the full-screen grid, detail pages and the
customize sheet. Its layout is keyed by the active profile, so switching
profiles remounts all of it and nothing of the previous profile survives on
screen.

`(app)` is reachable while the gate is `starting`, too, showing the boot spinner
behind the splash screen. A link that opened the app keeps its target that way;
were `(app)` guarded until `ready`, the router would replace the link with the
boot screen before the app could honour it. If the gate settles anywhere else —
a PIN to enter, a profile to pick — the guards take over as usual and the link
is dropped.

## Where a source comes from

Every connection belongs to the device. Its `perProfile` mode decides what each
profile keeps for itself: nothing (`none`), its own sign-in (`credentials`), or
its own value for every field and setting (`all`). For the active profile,
`services/sources.ts` resolves each connection of each installed plugin to one
of three standings:

| Standing | When | What the profile sees |
| --- | --- | --- |
| live | shared, or the profile's own values are complete | the connection's titles |
| pending | the profile has not filled in its own values | "Finish setting up" on Media |
| off | the profile was switched off for it | nothing at all |

A live source carries the values it runs with — shared values, with the
profile's own where the mode separates them — and `@sc/api`'s `effectiveRoles`
runs on those resolved values. Under `all`, two profiles can differ in what the
same connection may do. The screens only ever see that result.

## Talking to sources

`services/media/` is the only place that calls a plugin's media role.

- **One provider per connection and credential scope** (`pool.ts`). Every
  profile sharing a login shares a provider and a session: a provider each
  would sign in again and again, and a server that allows one token per device
  would end each session with the next. A provider is replaced when the
  resolved values change — its fingerprint covers fields, settings and the
  credentials ref, never a secret: a changed secret gets a new ref.
- **It never throws.** Rows, the grid and Continue Watching fan out to every
  live source and merge what arrives; a source that failed comes back as a
  `SourceError` beside the others' results, and the home shows one quiet line
  for it.
- **Retry hints decide what happens next.** `backoff` rows are asked again every
  30 seconds. `network-change` parks the source: later calls return the parked
  error without touching the plugin until the network changes or the user
  refreshes. A failed sign-in (`UNAUTHORIZED`) parks it too, because servers lock
  accounts that keep trying.
- **Merging keeps the source's order.** Each plugin returns items in
  `compareItems` order; rows merge sorted lists, and the grid merges buffered
  pages that stop as soon as one source runs dry, because past that point the
  order can no longer be proved.
- **What a source answered is kept,** per profile, where the source allows it
  (`offlineMetadata`, and its switch). A source that fails is represented by
  what was saved from it, marked with when (`SourceError.savedAt`); on the grid
  only on the first page, as a finished source the merge never pages. At
  launch the hooks show saved rows as `placeholderData` from a second, local
  query — never `setQueryData`, which would make a snapshot look fresh and let
  the grid page from old positions.

## The account and its sync

A device has at most one account: the one connection whose sync role is on.
`services/account.ts` is the only thing that switches a sync role, and
`services/sync/` is the engine that keeps the account and the device in step.

- **A run** (`sync/engine.ts`) pulls the account's log from the device's
  cursor, applies it page by page — each page in one transaction together with
  the new cursor — then pushes the journal after the checkpoint. The account's
  log order decides every conflict; no clock does.
- **Four rules** decide what a pulled change does (`sync/apply.ts`):
  1. A change this device has not had back from the account protects its
     entity — pending, or accepted and on its way back. A pulled change to it
     is skipped: this device's is later in the log.
  2. A remote delete of a profile or connection is always applied.
  3. The device's own changes come back and are applied like any other, which
     is what makes every device converge.
  4. A pulled change carrying the id of a pending entry is that entry's lost
     acknowledgement.
- **Joining** (`sync/join.ts`) — signing in, switching, an account that lost
  data (`reset`), or one that carries more — reads the whole log, settles what
  both sides hold, and announces this device's rows in the journal for the
  normal push to upload. Carrying less is remembered, so carrying it again
  later joins again: what changed meanwhile was never sent.
- **When it runs** (`sync/scheduler.ts`): at launch, on coming to the
  foreground, two seconds after a journaled commit, when the network changes,
  every minute in the foreground, and on "Sync now" — never inside a write.
  Retry hints decide the rest: `backoff` doubles up to 15 minutes, and nothing
  but a new network cuts it short; `network-change` waits for one; an account
  that refused the sign-in waits for the user, always. On the web a run holds a
  Web Lock, so two tabs never sync at once.
- **Afterwards** — after a run, and after a sign-in's join — the engine tells
  its listeners what changed: the composition lets running providers go and
  has the session gate look again; the UI refreshes what it shows.

**Signing in** is two steps. `prepareSignIn` checks the owner, tries the
account once and reads it whole, saving nothing. `completeSignIn` writes the
account's connection, applies what the account holds and announces this
device's rows, all in one transaction. Between the two, the UI asks "Use the
account's profiles" or "Keep both" when both sides hold profiles. Signing in
again to this device's account takes its passwords and nothing else: a new
address would be another account, reached without switching.

**The owner check** (`services/owner-check.ts`) re-verifies whoever owns the
device's profiles: the account's own check when it has one, else Face ID or
the passcode. Forgot PIN goes through it, and so do signing in on a device
that has profiles, signing out and switching. Signing in again to the same
account does not: its password is the proof, and an account that refused the
old one could not vouch for the owner either.

## Query keys

Every key is prefixed with the active profile (`userKey`) or with `device`
(`deviceKey`). What a source answered also carries `remote`
(`remoteKey`), which splits it from local state:

- Local changes — renaming a profile, editing the home layout — refresh local
  keys only, never every server.
- Remote queries use `networkMode: 'always'`: a server at home answers without
  the internet, so React Query must never hold them back as "offline".
- Refresh — pull to refresh, or the web toolbar — unparks sources and
  invalidates the profile's remote keys; a changed network does the same.

## State ownership

| State | Lives in |
| --- | --- |
| Profiles, connections, per-profile values, preferences, device settings, the change journal | repositories — SQLite on native, IndexedDB on web |
| Passwords, PINs | the credential store — the keychain on native, encrypted IndexedDB on web |
| Session tokens, the device key | the device-bound credential store — the keychain, never restored onto another phone |
| Reads for screens, titles from sources | TanStack Query, every key prefixed by `device` or by the active profile |
| The session gate | the session service, read with `useSyncExternalStore` |
