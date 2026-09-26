# API

`@sc/api` is the vocabulary the app and every plugin are written in. It depends
on nothing — not React, not Expo, not the app — so any of them can use it
without learning about the others.

## What is in it

| File | What it defines |
| --- | --- |
| `ids.ts` | Branded IDs: `PluginId`, `UserId`, `ConnectionId`, `CredentialsRef`. A `UserId` is a string at runtime, but the compiler will not accept one where a `ConnectionId` belongs. |
| `content.ts` | `ContentKind` — what a source brings: `movies`, `shows`, `anime`, `videos`, `files`. |
| `capabilities.ts` | The media and sync capability flags, and `CapabilityKey` (`'media.browse'`, `'sync.watchProgress'`), the form a setting uses to gate one. |
| `fields.ts` | The field descriptors a plugin uses to ask for input: `text` (optionally a `credential`), `url`, `password`, `boolean`, `select`, and the setting-only `libraries`. |
| `manifest.ts` | `PluginManifest` and `Plugin` — what a plugin package exports: the manifest, plus a role's implementation once it exists. |
| `connection.ts` | `Connection` — one configured instance of a plugin, owned by the device — and `PerProfile`, which says what each profile keeps for itself. |
| `per-profile.ts` | Which keys a mode keeps per profile, the values one profile runs with (`resolveValues`), and whether a profile is set up (`isSetUpFor`). |
| `user.ts` | `AppUser` — a local profile. |
| `effective.ts` | `effectiveRoles()` — what a connection may actually do. |
| `validate.ts` | `validateManifest()` — the rules every manifest must satisfy. |
| `media.ts` | `MediaItem` (movie, show, season, episode), `GlobalMediaKey`, `MediaDetail`, `Person`, `Library`, `WatchStatus`, and opaque `ImageRef` / `HeadersRef`. |
| `query.ts` | `ItemQuery`, `ItemPage`, the four sorts, `compareItems()` — the one ordering rule — and `mergeSorted()`. |
| `errors.ts` | `AppError`: a code from the spec, a retry hint, and an optional reason. |
| `http.ts` | `HttpClient`, the port a plugin reaches the network through, and `TransportError`. |
| `media-role.ts` | `MediaRole`, `ConnectedMediaProvider`, `MediaContext`, and `MEDIA_CAPABILITY_MEMBERS`. |

Not yet written: the sync role contract and playback descriptors.

## The manifest

```ts
export const plugin: Plugin = {
  manifest: {
    id: pluginId('jellyfin'),
    displayName: 'Jellyfin',
    description: 'Self-hosted film and TV server.',
    media: {
      contentKinds: ['movies', 'shows'],
      capabilities: ['browse', 'libraries', 'watchStateRead', 'remoteImages', 'offlineMetadata'],
    },
    connectionFields: [
      { key: 'serverUrl', label: 'Server address', type: 'url', required: true },
      { key: 'localOnly', label: 'Local network only', type: 'boolean', default: true },
      { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    settings: [
      { key: 'cacheMetadata', label: 'Keep metadata on this device', type: 'boolean', default: true, gates: ['media.offlineMetadata'] },
      { key: 'libraries', label: 'Libraries to show', type: 'libraries', default: { mode: 'all' } },
    ],
  },
  media: { connect: async (target, context) => createProvider(target, context) },
};
```

- **Roles** — `media` and `sync` are both optional. A role that is not declared
  is absent, and the app never asks for it.
- **`contentKinds`** — what the source brings. The plugin states it; the app
  decides where each kind appears.
- **`connectionFields`** — what a connection needs: endpoint, account, secrets.
  They are shared by every role, because one connection has one endpoint and
  one set of credentials. The app's Settings screen renders them; it has no
  form of its own for any plugin.
- **`settings`** — plain values, capability toggles, and at most one
  `libraries` choice. See `settings/`.

## Connections

A connection is one configured instance of a plugin — "Jellyfin Home". Two
connections to the same plugin are normal. Every connection belongs to the
device. It records:

- which roles are switched on
- its `perProfile` mode
- its shared `values`: non-secret field values, settings, and an opaque
  `credentialsRef` pointing at the secret values in the app's credential store,
  plus the *names* of the saved secrets

What each profile keeps for itself is stored with the profile. `resolveValues`
combines the two for one profile.

## The media contract

```ts
const provider = await plugin.media.connect(target, context); // no network work yet
await provider.check();                 // reach the server and sign in
await provider.listItems({ kind: 'movies', sort: { by: 'releaseDate', order: 'desc' }, limit: 30 });
```

- **`target`** — the connection's values, resolved for the profile the provider
  runs for.
- **`context`** — everything a plugin may use from its host:
  - `http` — requests
  - `credentials` — this target's password-field values
  - `session` — a secret it may keep, such as a token; scoped by the app and
    dropped when the credentials change
  - `network` — what kind of network the device is on
  - `client` — app, version, device and a stable installation id
  - `clock` — `now` and `sleep`
- **Pages come in `compareItems` order.** The app merges several sources with
  that same function, and a plugin merges its own libraries with it.
- **Items are plain data**, connection-qualified, and carry the source's
  `watch` status. The source is the master of that status; the app caches it.
- **Artwork is an `ImageRef`** only the plugin can turn into an `ImageSource`,
  synchronously. Headers an image needs are resolved separately and never
  stored.
