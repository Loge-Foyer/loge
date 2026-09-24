# AGENTS.md — streaming_center_plugins

Every adapter Streaming Center has to the outside world, plus the vocabulary
they are written in. Read the workspace root `AGENTS.md` and
`../.claude/streaming-center-architecture.md` first.

---

## Shape

```
packages/
  plugin-api/          domain types + every contract. Depends on NOTHING
  media/
    jellyfin/ plex/ emby/ yattee/ invidious/ webdav/ mock/
  sync/
    icloud/ google/ custom-server/ jellyfin/ local/
```

npm workspaces, source-only — `"exports": "./src/index.ts"`, no build step.

## Boundaries

| Package | May import | Must not import |
| --- | --- | --- |
| `plugin-api` | nothing | react, react-native, expo\*, any plugin, the app |
| any plugin | `@sc/plugin-api` | any framework, the app, another plugin |

`plugin-api` is the centre of the whole project — the app depends on it, every
plugin depends on it, the sync server depends on it. It must stay a leaf. If you
need a capability there, declare an interface and implement it outside.

**Plugins never import each other.** Jellyfin-the-media-plugin and
Jellyfin-the-sync-plugin are separate packages on purpose; if they eventually
share an HTTP client, that client becomes its own package rather than an import
across the boundary.

---

## The two contracts

### Media plugins — expose content

```ts
interface MediaProvider {
  readonly descriptor: MediaProviderDescriptor;   // id, displayName, capabilities
  connect(connection, context): Promise<ConnectedMediaProvider>;
}
```

`ConnectedMediaProvider` members are optional and mirror the capability flags:
`getHome`, `search`, `getItem`, `getChildren`, `getLibraries`,
`getPlaybackDescriptor`, `dispose`.

### Sync plugins — transport the app's own state

```ts
interface UserStateSyncProvider {
  readonly descriptor: UserStateSyncProviderDescriptor;
  connect(config, context): Promise<ConnectedUserStateSyncProvider>;
}
```

`ConnectedUserStateSyncProvider` is four methods: `pull`, `push`, `getStatus`,
`dispose`.

A media plugin is **not** automatically a sync plugin. A service can be both, as
two separate implementations. This separation is mandatory — it is what allows
media from Jellyfin with state synced to iCloud.

---

## Non-negotiables

1. **Declare capabilities honestly.** They are not documentation; application
   code branches on them. Declaring `search: true` while `search()` throws turns
   every query into a `sourceError`. Declaring `false` means the method is never
   called.

2. **Map at the boundary.** Remote payloads become domain types *inside* this
   package. No external type may appear in a return value. Anything the adapter
   needs on a later call goes in provider-scoped metadata that nothing else
   reads.

3. **Secrets through the injected credential store.** A connection stores only
   an opaque `credentialsRef`. Settings are a plain database column — never put
   a token there. Artwork needing auth carries a `headersRef`, never an inline
   header.

4. **Normalize errors.** Throw a typed application error with a known code. A
   raw HTTP error reaching the UI is a bug.

5. **Never assume you are the only connection.** Two connections to the same
   plugin are normal; a connected plugin carries its `connectionId`.

### Sync plugins specifically

6. **`push` must be idempotent.** It may receive the same change twice after a
   crash or a rejected batch. Return the IDs you **accepted** — the engine
   advances its checkpoint only across the accepted prefix and retries the rest
   verbatim.

7. **`pull` must be resumable.** Return an opaque cursor, stored per connection
   so targets progress independently.

8. **Do not resolve conflicts.** The app's conflict resolver owns that. If a
   backend needs entity-specific rules, that is a change to the resolver, not to
   the adapter.

9. **Overstating capabilities causes silent data loss.** The engine filters the
   change journal by what you declare. Claim support you lack and the engine
   hands you changes you drop *and advances the checkpoint past them* — no
   error, gone.

---

## Changing `plugin-api`

It ripples into every plugin and into the app. When you change a contract:
update `plugin-api`, then each plugin implementing it, then the app. Commit each
repository separately.

Nothing enforces cross-repo consistency. Verify by hand.

If adding a plugin requires changing the app's screens, schema or services, the
abstraction in `plugin-api` is wrong — fix that instead of working around it.
That is the test of whether this architecture is real.

---

## Current state

Every package is a `package.json`, a `src/index.ts` containing `export {}`, and
a README stating what will go there. **`plugin-api` is empty too** — the
contracts above are specified in
`../.claude/streaming-center-architecture.md` but not yet written as code.

Implement `plugin-api` before any plugin. Nothing else can be built correctly
until the vocabulary exists.

## Verify

```bash
npm install
npm run typecheck
```
