---
name: sc-verify-plugins
description: Run the verification pass for the Streaming Center plugins repository — install, typecheck, boundary checks, and confirming the app still bundles. Use before committing here, or after changing anything in api.
---

# Verify the plugins repository

```bash
npm install
npm run typecheck
npm test
```

`npm test` runs vitest over `test/`: the effective-roles rule, manifest
validation, and a conformance check running `validateManifest` over every
plugin. Tests live in `test/`, never in `api/src` — a `from 'vitest'` there
would break the first boundary check below.

## After changing `api`

`api` is the centre of the entire project. A change there ripples into every
plugin **and** into the app, and **nothing enforces cross-repository
consistency**. Verify by hand, in this order:

```bash
npm run typecheck && npm test                       # this repo
cd ../streaming_center_app && npm run typecheck     # the consumer
cd ../streaming_center_app && npx expo export --platform ios --output-dir /tmp/sc-ios
cd ../streaming_center_app && npx expo export --platform web --output-dir /tmp/sc-web
```

The bundle matters because the app depends on this repository through a `file:`
path. Metro resolution across the repository boundary fails in ways `tsc` cannot
see.

## Boundary checks

These are rules, not lint, until someone writes the lint. Check by reading:

```bash
# api must import nothing from this project or any framework
grep -rn "from '" api/src/ | grep -v "from '\./" | grep -v "from '\.\./"

# no plugin may import another plugin
grep -rnE "(from|import\(|require\()\s*['\"]@sc/plugin-" plugins/*/src/

# no framework in any plugin
grep -rnE "from 'react|from 'expo|react-native" plugins/*/src/ api/src/

# no host globals: everything goes through the injected context
grep -rnE "\bfetch\(|new URL\(|\bconsole\.|\bsetTimeout\(|\bbtoa\(|\batob\(" api/src plugins/*/src
```

All four should return nothing. The compiler already refuses host globals
(`lib: ["esnext"]`); the last grep catches them in files it has not seen yet. Any hit is a boundary violation, and the whole
split exists to prevent exactly those.

## Built-ins Hermes lacks

The compiler cannot help with the opposite problem: `esnext` offers built-ins
that Hermes — the engine running plugins on iOS and Android — does not have.
`Array.prototype.toSorted`, `Object.groupBy` and `crypto.randomUUID` typecheck,
pass every test on Node, and throw on a phone. `test/engine.test.ts` scans every
source for them, so `npm test` fails on a new use. When Hermes turns out to lack
something else, add it to that list and to the app's lint rule together.

## Manifest sanity

For each plugin, confirm by reading its manifest:

- a declared sync capability means a sync role with every provider member (the
  conformance test), and one kept per profile comes with `profile`
  (`validateManifest`)
- no capability is declared that the implementation cannot actually honour.
  The conformance test checks that the members exist; honouring them is what
  each plugin's own tests are for.
- media servers (`jellyfin`, `emby`, `plex`) have no sync role
- the roles in `README.md` match the roles in the manifest
- the roster in `../.claude/streaming-center-architecture.md` section 8 matches
  reality

Overstating a capability is the most expensive mistake available here: the sync
engine filters the change journal by what you declare, so claiming support you
lack means changes are handed to you, dropped, and the checkpoint advances past
them. Silent data loss, no error.

## Current state

`api` holds the manifest vocabulary, the media contract and the sync contract.
Jellyfin and mock implement the media role, and mock the sync role as a
pretend account. Passing checks prove:

- the vocabulary and every manifest
- Jellyfin's behaviour against recorded payloads
- that every declared media capability is implemented, and that no plugin
  declares a sync capability without a sync role
- the sync wire: what `isSyncChange` lets through

Run the app's verification as well before calling a contract change done.
