---
name: sc-verify-plugins
description: Run the verification pass for the Streaming Center adapters — typecheck, boundary checks, and confirming the app and the sync server still build. Use before committing a change under adapters/, or after changing anything in api.
---

# Verify the adapters

The adapters are workspaces of the app, so everything runs from the app's
root — there is no separate install:

```bash
cd ..            # streaming_center_app
npm run typecheck    # five programs: the app, its tests, and the adapters' three
npm test             # two vitest projects: the app's suite and the adapters'
```

`npm run typecheck` runs three programs:

1. **`api` and the non-player plugins,** with no host types at all
   (`"types": []`).
2. **Player plugins and `player-kit`** (`tsconfig.players.json`), with React
   Native's types and the DOM's.
3. **The tests** (`test/tsconfig.json`), with Node's.

Keep them apart. Node's or React Native's types in the first program would let
`Buffer`, `TextEncoder`, `fetch` and timers into plugin code without a word
from the compiler.

`npm test` runs vitest over `test/`:

- the api rules, and the conformance check running `validateManifest` over
  every plugin, per category
- account records against `api/fixtures/account-records.json`

Tests live in `test/`, never in `api/src` — a `from 'vitest'` there would break
the first boundary check below.

## After changing `api`

`api` is the centre of the entire project. A change there ripples into every
plugin **and** into the app. Only the account records' fixtures are shared with
the server; **nothing else enforces cross-repository consistency**. Verify by
hand, in this order:

```bash
cd ..                                                      # streaming_center_app
npm run typecheck && npm test
npx expo export --platform ios --output-dir /tmp/sc-ios
npx expo export --platform web --output-dir /tmp/sc-web
```

The bundle still matters: Metro resolves what `tsc` does not, and a player's
`.web` and native files are only ever chosen at bundle time.

**After changing an account record** (`api/src/account.ts` or
`api/fixtures/account-records.json`), run the sync server's tests too:

```bash
cd ../../streaming_center_sync && go test ./... && (cd harness && npm test)
```

`internal/fixtures/fixtures.go` reads that fixtures file by path, and the
harness aliases `@sc/api` and `@sc/sync-custom-server` to their source here.
Both break the moment either side moves — as they did when the adapters moved
in.

## Boundary checks

These are rules, not lint, until someone writes the lint. Check by reading.
Adapters sit at `<category>/<name>/src`, relative to `adapters/`.

```bash
# api must import nothing from this project or any framework
grep -rn "from '" api/src/ | grep -v "from '\./" | grep -v "from '\.\./"

# no adapter may import another adapter — player-kit is a contract, not an adapter
grep -rnE "(from|import\(|require\()\s*['\"]@sc/(source|iptv|player|sync|metadata)-" sources/ iptv/ players/ sync/ metadata/ \
  | grep -v "@sc/player-kit'"


# no framework in api or any non-player plugin
find api/src sources iptv sync metadata -type f -name '*.ts' -path '*/src/*' -not -path '*/node_modules/*' \
  -exec grep -HnE "from 'react|from 'expo|react-native" {} +

# no host globals outside players: everything goes through the injected context
find api/src sources iptv sync metadata -type f -name '*.ts' -path '*/src/*' -not -path '*/node_modules/*' \
  -exec grep -HnE "\bfetch\(|new URL\(|\bconsole\.|\bsetTimeout\(|\bbtoa\(|\batob\(" {} +
```

All four should return nothing. The `find` form works in zsh and bash alike.
A glob such as `*/*/src` would abort in zsh wherever it matches nothing — and
note that `grep` in some shells here is a function that skips gitignored
paths; use `command grep` if a check returns suspiciously little.

- The compiler already refuses host globals (`lib: ["esnext"]`); the last grep
  catches them in files it has not seen yet.
- Players are left out of the last two on purpose: they draw, so React, React
  Native and their engine are theirs. They still import no other plugin.

Any hit is a boundary violation, and the whole split exists to prevent exactly
those.

## Built-ins Hermes lacks

The compiler cannot help with the opposite problem: `esnext` offers built-ins
that Hermes — the engine running plugins on iOS and Android — does not have.

- `Array.prototype.toSorted`, `Object.groupBy`, `crypto.randomUUID` and
  `Uint8Array.prototype.toBase64` / `fromBase64` typecheck and throw on a phone
  (the last two on Node 24 as well).
- `test/engine.test.ts` scans every source for them, so `npm test` fails on a
  new use.
- When Hermes turns out to lack something else, add it to that list and to the
  app's lint rule together.

## Manifest sanity

For each plugin, confirm by reading its manifest:

- **Its category and folder agree.** The id is `<category>/<name>`, and it
  declares exactly its category's one block: `media` for sources and IPTV,
  `player` for players, `account` or `backup` for sync.
- **`platforms` is honest.** Nothing claims `web` that a browser cannot reach,
  and a player's profiles name only platforms it runs on.
- **No capability is declared that the implementation cannot honour.** The
  conformance test checks that the members exist; honouring them is what each
  plugin's own tests are for.
- **The account block's extras have their members.** An `ownerProof` names
  password fields and comes with `verifyOwner`; a `signUp` comes with
  `createAccount`.
- **Media servers** (`jellyfin`, `emby`, `plex`) are sources and nothing else.
- **The README** states the same category, kinds and platforms as the
  manifest.
- **The roster** in `../.claude/streaming-center-architecture.md` section 8
  matches reality.

Overstating a capability is the most expensive mistake available here. The app
acts on what you declare: rows that error, players that show a black screen,
state an account quietly drops.

## Current state

**`api` holds:**

- categories, platforms and qualified ids
- the media contract, with live TV and playback members
- the player contract and `choosePlayer`
- the account role, by record, with fixtures shared with the server
- the backup role
- the host's crypto port

**The plugins,** in their category folders with qualified ids:

- **`sources/jellyfin` and `sources/mock`** implement the media role.
- **`sync/custom-server` and `sync/mock`** implement the account role, and
  **`sync/mock-backup`** the backup role.
- **Every other plugin** is a manifest: IPTV, the players with no profile,
  and the backup targets.

**Passing checks prove:**

- the vocabulary and every manifest
- Jellyfin's behaviour against recorded payloads
- that every declared media capability is implemented
- account records judged as the fixtures say
- choosing a player
- bytes as text, and the limits on a key's parameters

Run the app's verification as well before calling a contract change done.
