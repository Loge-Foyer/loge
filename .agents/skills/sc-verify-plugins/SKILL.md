---
name: sc-verify-plugins
description: Run the verification pass for the Streaming Center plugins repository — install, typecheck, boundary checks, and confirming the app and the sync server still build. Use before committing here, or after changing anything in api.
---

# Verify the plugins repository

```bash
npm install
npm run typecheck
npm test
```

`npm run typecheck` runs two programs today, three once a player plugin
exists:

1. **`api` and the non-player plugins,** with no host types at all
   (`"types": []`).
2. **Player plugins and `player-kit`,** with React Native's types.
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
npm run typecheck && npm test                       # this repo
cd ../streaming_center_app && npm run typecheck && npm test
cd ../streaming_center_app && npx expo export --platform ios --output-dir /tmp/sc-ios
cd ../streaming_center_app && npx expo export --platform web --output-dir /tmp/sc-web
```

The bundle matters because the app depends on this repository through `file:`
paths. Metro resolution across the repository boundary fails in ways `tsc`
cannot see.

**After changing an account record** (`api/src/account.ts` or its fixtures),
run the sync server's tests too. Until Phase 6 that is the TypeScript server:
`cd ../streaming_center_sync && npm test`. From Phase 6 it is
`go test ./...`, plus `cd harness && npm test` there.

## Boundary checks

These are rules, not lint, until someone writes the lint. Check by reading. The
paths below cover both layouts: today's `plugins/<id>/src`, and the categories'
`plugins/<category>/<name>/src` after Phase 6.

```bash
# api must import nothing from this project or any framework
grep -rn "from '" api/src/ | grep -v "from '\./" | grep -v "from '\.\./"

# no plugin may import another plugin
grep -rnE "(from|import\(|require\()\s*['\"]@sc/(plugin|source|iptv|player|sync)-" plugins/

# no framework in api or any non-player plugin
find api/src plugins -type f -name '*.ts' -path '*/src/*' -not -path '*/players/*' -not -path '*/node_modules/*' \
  -exec grep -HnE "from 'react|from 'expo|react-native" {} +

# no host globals outside players: everything goes through the injected context
find api/src plugins -type f -name '*.ts' -path '*/src/*' -not -path '*/players/*' -not -path '*/node_modules/*' \
  -exec grep -HnE "\bfetch\(|new URL\(|\bconsole\.|\bsetTimeout\(|\bbtoa\(|\batob\(" {} +
```

All four should return nothing. The `find` form works in zsh and bash alike,
and in either layout. A glob such as `plugins/*/*/src` would abort in zsh
wherever it matches nothing.

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
- Phase 4's roles and log-based sync role, until Phase 6

**The plugins:**

- **Jellyfin and the mock** implement the media role.
- **The mock and `custom-server`** implement Phase 4's sync role.

**Passing checks prove:**

- the vocabulary and every manifest
- Jellyfin's behaviour against recorded payloads
- that every declared media capability is implemented
- account records judged as the fixtures say
- choosing a player
- bytes as text, and the limits on a key's parameters

Run the app's verification as well before calling a contract change done.
