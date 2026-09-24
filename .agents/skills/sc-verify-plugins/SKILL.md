---
name: sc-verify-plugins
description: Run the verification pass for the Streaming Center plugins repository — install, typecheck, boundary checks, and confirming the app still bundles. Use before committing here, or after changing anything in api.
---

# Verify the plugins repository

```bash
npm install
npm run typecheck
```

That is the whole automated suite today. There are no tests yet, because there
is no implementation to test — every package is an `export {}`.

## After changing `api`

`api` is the centre of the entire project. A change there ripples into every
plugin **and** into the app, and **nothing enforces cross-repository
consistency**. Verify by hand, in this order:

```bash
npm run typecheck                                   # this repo
cd ../streaming_center_app && npm run typecheck     # the consumer
cd ../streaming_center_app && npx expo export --platform ios --output-dir /tmp/sc-ios
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
grep -rn "@sc/plugin-" plugins/*/src/

# no framework in any plugin
grep -rnE "from 'react|from 'expo|react-native" plugins/*/src/ api/src/
```

All three should return nothing. Any hit is a boundary violation, and the whole
split exists to prevent exactly those.

## Manifest sanity

For each plugin, confirm by reading its manifest:

- every declared sync capability has a **toggle defaulting to `false`**
- no capability is declared that the implementation cannot actually honour
- the roles in `README.md` match the roles in the manifest
- the roster in `../.claude/streaming-center-architecture.md` section 8 matches
  reality

Overstating a capability is the most expensive mistake available here: the sync
engine filters the change journal by what you declare, so claiming support you
lack means changes are handed to you, dropped, and the checkpoint advances past
them. Silent data loss, no error.

## Current state

`api` plus eleven plugins, all placeholders. `npm run typecheck` passing proves
the workspace wiring is sound and nothing more.
