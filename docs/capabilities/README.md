# Capabilities

Two levels, and the difference matters.

**Declared** capabilities are static, in the manifest: what a plugin *can* do.
**Effective** capabilities are per connection: what the user has allowed it to
do. The app branches on effective, always — branching on declared would call
features the user switched off.

## The rule

`effectiveRoles(manifest, { roles, settings })` computes it, so the app and
anything else agree on one definition:

- A **role** is in effect when the plugin declares it **and** the connection
  has it switched on. A role missing from the connection counts as off, so a
  role a plugin gains later never appears enabled on an existing connection.
- A declared **capability** is in effect when every toggle that gates it is on
  — the stored value, or the toggle's default when nothing is stored.
- A capability no toggle gates simply follows its role.
- `settings` are the ones the connection runs with **for a profile**
  (`resolveValues`). A connection that keeps every setting per profile can
  cache metadata for one profile and not another.

The result always has both keys: `{ media, sync }`, each `null` when that role
is not in effect.

## The media capabilities

| Capability | Means | Provider members |
| --- | --- | --- |
| `browse` | It lists titles of the kinds it brings, and opens them | `listItems`, `getItem`, `getChildren` |
| `libraries` | It has libraries the user can choose between | `getLibraries` |
| `watchStateRead` | Items carry what the user watched there; there is a resume list | `getResume` |
| `remoteImages` | Items carry artwork | `resolveImage`, `resolveHeaders` |
| `offlineMetadata` | Items keep stable ids and tag-versioned artwork, so the app may keep them on the device | none — a permission, not a call |
| `search`, `collections`, `playlists`, `channels`, `live`, `watchStateWrite`, `favoritesRead`, `favoritesWrite` | Named now, promised by nobody yet | arrive with their first implementation |

`MEDIA_CAPABILITY_MEMBERS` in `api` is that table in code.

## The sync capabilities

A sync capability says what an account can hold. The app hands an account only
the kinds it carries, and a kind needs every capability it depends on
(`SYNC_ENTITY_CAPABILITIES` in `api`):

| What travels | Needs |
| --- | --- |
| a profile, and its PIN | `profile` |
| a profile's preferences | `profile`, `preferences` |
| a connection | `providerConnections` |
| a profile's values on a connection | `providerConnections`, `profile` |
| `watchProgress`, `favorites`, `watchlist`, `history`, `customLists`, `fullBackup` | named, and carried by nothing in the app yet |

A capability kept per profile needs `profile`; `validateManifest` checks it.
Signing in to an account is the opt-in, so a sync capability needs no toggle. A
plugin may offer one anyway — to keep history back, say — and it may default
on.

## Declare honestly

Capabilities are not documentation.

- **Media:** declaring `browse` means the app calls `listItems`. If that
  throws, every row shows an error for that source.
- **Sync:** the sync engine filters the change journal by what you declare.
  Claim support you lack and it hands you changes you drop *and advances the
  checkpoint past them* — silent data loss.

So a capability is declared in the same change that implements it. The
conformance test (`test/manifests.test.ts`) connects every plugin that has a
media role, with a fake context, and checks that each declared capability's
members exist. A plugin with no implementation must declare no media
capability, and a plugin declaring sync capabilities must have a sync role
whose connected provider has `pull`, `push`, `getStatus` and `dispose`
(`SYNC_PROVIDER_MEMBERS`). `mock` declares a deliberately partial set, so the
app's capability handling is exercised rather than assumed.
