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
docs/
```

npm workspaces (`["api", "plugins/*"]`), source-only —
`"exports": "./src/index.ts"`, no build step.

## One plugin per service

**Not one per role.** Jellyfin serves a library *and* holds viewing state; it is
`plugins/jellyfin`, one package, two roles. Same for Emby, Plex, iCloud, Google
and mock.

| Plugin | media | sync |
| --- | :---: | :---: |
| `jellyfin` `emby` `plex` | ✓ | ✓ |
| `icloud` `google` | ✓ (Drive files) | ✓ |
| `mock` | ✓ | ✓ |
| `yattee` `invidious` `webdav` | ✓ | — |
| `custom-server` `local` | — | ✓ |

Do not create `plugins/jellyfin-sync`. If a service gains a second role, add the
role to its existing manifest.

## Boundaries

| Package | May import | Must not import |
| --- | --- | --- |
| `api` | nothing | react, react-native, expo\*, any plugin, the app |
| any plugin | `@sc/api` | any framework, the app, another plugin |

`api` is the centre of the whole project — the app depends on it, every plugin
depends on it, the sync server depends on it. It must stay a leaf. If you need a
capability there, declare an interface and implement it outside.

**Plugins never import each other.** If two eventually need the same HTTP
client, that client becomes its own package rather than an import across the
boundary.

---

## The manifest

```ts
interface PluginManifest {
  readonly id: PluginId;
  readonly displayName: string;
  readonly media?: { capabilities: MediaCapabilities; connectionFields: Field[] };
  readonly sync?: { capabilities: SyncCapabilities; connectionFields: Field[] };
  readonly settings: readonly PluginSettingDescriptor[];
}
```

A role you do not declare is absent, and the app never asks for it.

### Media role

`connect()` returns a `ConnectedMediaProvider`. Members are optional and mirror
the capability flags: `getHome`, `search`, `getItem`, `getChildren`,
`getLibraries`, `getPlaybackDescriptor`, `dispose`.

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
interface PluginSettingDescriptor {
  readonly key: string;              // 'syncWatchProgress'
  readonly label: string;
  readonly type: 'boolean' | 'text' | 'url' | 'password' | 'select';
  readonly default: unknown;         // false for every sync toggle
  readonly gates?: readonly CapabilityKey[];
  readonly secret?: boolean;
}
```

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

3. **Secrets through the injected credential store.** A connection stores only
   an opaque `credentialsRef`. Settings are a plain database column — never put
   a token there. Artwork needing auth carries a `headersRef`, never an inline
   header.

4. **Normalize errors.** Throw a typed application error with a known code. A
   raw HTTP error reaching the UI is a bug.

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

Twelve packages: `api` plus eleven plugins. Each is a `package.json`, a
`src/index.ts` containing `export {}`, and a README stating its roles and what
belongs there. **`api` is empty too** — the contracts above are specified in
`../.claude/streaming-center-architecture.md` but not yet written as code.

Implement `api` before any plugin. Nothing else can be built correctly until the
vocabulary exists.

## Verify

```bash
npm install
npm run typecheck
```
