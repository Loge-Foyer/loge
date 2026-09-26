# AGENTS.md — streaming_center_plugins

Every adapter Streaming Center has to the outside world, plus the vocabulary
they are written in. Read the workspace root `AGENTS.md` and
`../.claude/streaming-center-architecture.md` first.

---

## Shape

```
api/                 @sc/api — domain types + every contract. Depends on NOTHING
plugins/
  jellyfin/ emby/ plex/ icloud/ google/ mock/
  yattee/ invidious/ webdav/ custom-server/ local/
test/                vitest — api rules, plugins against fake HTTP, conformance
docs/
```

npm workspaces (`["api", "plugins/*"]`), source-only —
`"exports": "./src/index.ts"`, no build step. Every plugin lists `@sc/api` as a
**peer** dependency: the host supplies the one instance, so branded IDs from
the app and from a plugin are the same type.

## One plugin per service

**Not one per role.** iCloud serves Drive files *and* can be the device's
account; it is `plugins/icloud`, one package, two roles. Same for Google and
mock.

| Plugin | media | sync |
| --- | :---: | :---: |
| `jellyfin` `emby` `plex` | ✓ | — |
| `icloud` `google` | ✓ (Drive files) | ✓ |
| `mock` | ✓ | ✓ |
| `yattee` `invidious` `webdav` | ✓ | — |
| `custom-server` `local` | — | ✓ |

**Media servers are media-only.** A media server is the master of what its
users watched: the app reads it (`watchStateRead`) and later writes progress
back (`watchStateWrite`) through the *media* role. A device has at most one
sync connection — the account — and a media server is never it.

Do not create `plugins/jellyfin-sync`. If a service gains a second role, add the
role to its existing manifest.

## Boundaries

| Package | May import | Must not import |
| --- | --- | --- |
| `api` | nothing | react, react-native, expo\*, any plugin, the app |
| any plugin | `@sc/api` | any framework, the app, another plugin |

`lib: ["esnext"]` gives `api` and plugins **no host globals**: no `fetch`,
`URL`, `console`, `setTimeout`, `btoa`, `AbortSignal`. The compiler rejects
them. A plugin reaches the host only through the `MediaContext` it is handed:
`http`, `credentials`, `session`, `network`, `client`, `clock`.

`api` is the centre of the whole project — the app depends on it, every plugin
depends on it, the sync server depends on it. It must stay a leaf. If you need a
capability there, declare an interface and implement it outside.

**Plugins never import each other.** If two eventually need the same HTTP
client, that client becomes its own package rather than an import across the
boundary.

---

## The manifest

Each plugin's `src/index.ts` exports `plugin: Plugin` — the same name
everywhere, so the app's registration line is always
`import { plugin as x } from '@sc/plugin-x'`.

```ts
interface PluginManifest {
  readonly id: PluginId;
  readonly displayName: string;
  readonly description: string;
  readonly media?: { contentKinds: readonly ContentKind[]; capabilities: readonly MediaCapability[] };
  readonly sync?: { capabilities: readonly SyncCapability[] };
  readonly connectionFields: readonly Field[];               // shared by every role
  readonly settings: readonly PluginSettingDescriptor[];     // never a password
}
```

A role you do not declare is absent, and the app never asks for it.

- **`contentKinds`** — what the source brings: `movies`, `shows`, `anime`,
  `videos`, `files`. The app decides where each kind appears; a plugin never
  names a tab.
- **`connectionFields`** — endpoint, account, secrets; one list for every role,
  because one connection has one endpoint and one set of credentials. The app
  renders them. A `password` field is the only secret. Mark a text field that is
  part of the account (a username) with `credential: true`: a connection that
  keeps credentials per profile keeps exactly those, plus every password.
- **A `libraries` setting** lets the user pick from the libraries the source
  reports. It needs the `libraries` capability, because the app fills it by
  asking the connection.
- **Capabilities** are declared with the code that honours them — the
  conformance test checks that every declared capability's members
  (`MEDIA_CAPABILITY_MEMBERS`) exist.
- `validateManifest()` in `api` enforces the rules below; `npm test` runs it over
  every plugin.

### Media role

`plugin.media.connect(target, context)` returns a `ConnectedMediaProvider`. It
does no network work: signing in waits for the first call. The target holds
the connection's values already resolved for one profile.

| Capability | Members |
| --- | --- |
| `browse` | `listItems`, `getItem`, `getChildren` |
| `libraries` | `getLibraries` |
| `watchStateRead` | `getResume` (items carry `watch` too) |
| `remoteImages` | `resolveImage` (synchronous), `resolveHeaders` |
| `offlineMetadata` | none — permission for the app to keep items on the device |

`check()` and `dispose()` are always present. Rules every provider follows:

- **Pages are ordered exactly by `compareItems(query.sort)`.** The app merges
  sources with it.
- **Sign-in is single-flight.** Several calls start together.
- **A refused login is never retried.** Servers lock accounts.
- **Throw only `AppError`**, with a retry hint: `backoff`, `network-change` or
  `never`.

### Sync role

`connect()` returns a `ConnectedUserStateSyncProvider`: `pull`, `push`,
`getStatus`, `dispose`.

---

## Declared versus effective capabilities

The distinction that matters most in this repository.

- **Declared** — static, in the manifest. What the plugin *can* do.
- **Effective** — per connection. Declared ∩ what the user switched on.

The app branches on **effective**. A setting can gate a capability:

```ts
type PluginSettingDescriptor = TextField | UrlField | SelectField | ToggleSetting | LibrariesField;

interface ToggleSetting {
  readonly key: string;                        // 'syncWatchProgress'
  readonly label: string;
  readonly type: 'boolean';
  readonly default: boolean;                   // false for every sync toggle
  readonly gates?: readonly CapabilityKey[];   // 'sync.watchProgress' — one role per toggle
}
```

`effectiveRoles(manifest, connection)` is the one definition: a role is in
effect when declared **and** switched on (missing means off); a declared
capability when every toggle gating it is on (stored value, else default); an
ungated capability follows its role.

**Every sync toggle defaults to off.** Connecting Jellyfin as a media source
must never start pushing watch state there. Merging the packages was allowed
precisely because the roles stay independently switchable — break that and the
merge has broken the property it was supposed to preserve.

---

## Non-negotiables

1. **Declare capabilities honestly.** They are not documentation; application
   code branches on them. Declaring `search: true` while `search()` throws turns
   every query into a `sourceError`. Declaring `false` means the method is never
   called.

2. **Map at the boundary.** Remote payloads become domain types *inside* this
   package. No external type may appear in a return value. Anything the adapter
   needs on a later call goes in provider-scoped metadata nothing else reads.

3. **Secrets through the injected credential store.** A secret is a `password`
   connection field; the connection stores only an opaque `credentialsRef`.
   Settings are a plain database column and cannot be `password` — the type
   refuses it, and `validateManifest` flags secret-looking keys on other field
   types. Artwork needing auth carries a `headersRef`, never an inline header.

4. **Normalize errors.** Throw `AppError` with a known code and a retry hint.
   A raw HTTP or transport error reaching the UI is a bug.

5. **Never assume you are the only connection.** Two connections to the same
   plugin are normal, and they may enable different roles.

### The sync role specifically

6. **`push` must be idempotent.** It may receive the same change twice after a
   crash or a rejected batch. Return the IDs you **accepted** — the engine
   advances its checkpoint only across the accepted prefix and retries the rest
   verbatim.

7. **`pull` must be resumable.** Return an opaque cursor, stored per connection
   so targets progress independently.

8. **Do not resolve conflicts.** The app's conflict resolver owns that.

9. **Overstating capabilities causes silent data loss.** The engine filters the
   change journal by what you declare. Claim support you lack and the engine
   hands you changes you drop *and advances the checkpoint past them* — no
   error, gone.

---

## Changing `api`

It ripples into every plugin and into the app. Update `api`, then each plugin
implementing the changed contract, then the app. Commit each repository
separately.

Nothing enforces cross-repo consistency. Verify by hand.

If adding a plugin requires changing the app's screens, schema or services, the
abstraction in `api` is wrong — fix that instead of working around it. That is
the test of whether this architecture is real.

---

## Skills

`.agents/skills/` in this repository:

- **`sc-add-plugin`** — create a new plugin for a service that has none.
- **`sc-plugin-roles`** — add or change a role on an existing plugin. Use this,
  not `sc-add-plugin`, when the service already has a folder.
- **`sc-verify-plugins`** — verification, including the boundary greps and the
  cross-repository check after touching `api`.

---

## Current state

`api` holds the manifest vocabulary and the **media contract**:

- `MediaItem` and friends
- `ItemQuery` / `compareItems` / `mergeSorted`
- `AppError` with retry hints
- `HttpClient`
- `MediaRole` / `ConnectedMediaProvider` / `MediaContext`
- per-connection per-profile values (`PerProfile`, `resolveValues`,
  `isSetUpFor`)

`SyncRole` is not written yet.

**Jellyfin** implements the media role. **Mock** implements it with a fixed
catalogue. Every other plugin is a manifest that declares no capability.

## Verify

```bash
npm install
npm run typecheck
npm test
```
