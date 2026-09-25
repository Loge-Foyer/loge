# API

`@sc/api` is the vocabulary the app and every plugin are written in. It depends
on nothing — not React, not Expo, not the app — so any of them can use it
without learning about the others.

## What is in it today

| File | What it defines |
| --- | --- |
| `ids.ts` | Branded IDs: `PluginId`, `UserId`, `ConnectionId`, `CredentialsRef`. A `UserId` is a string at runtime, but the compiler will not accept one where a `ConnectionId` belongs. |
| `content.ts` | `ContentKind` — what a source brings: `movies`, `shows`, `anime`, `videos`, `files`. |
| `capabilities.ts` | The media and sync capability flags, and `CapabilityKey` (`'media.search'`, `'sync.watchProgress'`), the form a setting uses to gate one. |
| `fields.ts` | The field descriptors a plugin uses to ask for input: `text`, `url`, `password`, `boolean`, `select`. |
| `manifest.ts` | `PluginManifest` and `Plugin` — what a plugin package exports. |
| `connection.ts` | `Connection` — one configured instance of a plugin, owned by the device or by a profile. |
| `user.ts` | `AppUser` — a local profile. |
| `effective.ts` | `effectiveRoles()` — what a connection may actually do. |
| `validate.ts` | `validateManifest()` — the rules every manifest must satisfy. |

Not yet written: the role contracts (`MediaRole`, `SyncRole`), `MediaItem`,
playback descriptors and the error model. They arrive with the first plugin
that implements a role.

## The manifest

```ts
export const plugin: Plugin = {
  manifest: {
    id: pluginId('jellyfin'),
    displayName: 'Jellyfin',
    description: 'Self-hosted film and TV server.',
    media: { contentKinds: ['movies', 'shows'], capabilities: [] },
    sync: { capabilities: [] },
    connectionFields: [
      { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    settings: [],
  },
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
- **`settings`** — plain values and capability toggles. See `settings/`.

## Connections

A connection is one configured instance of a plugin — "Jellyfin Home". Two
connections to the same plugin are normal. Each records who owns it (the device,
shared by every profile, or one profile), which roles are switched on, its
non-secret field values, its settings, and an opaque `credentialsRef` pointing
at the secret values in the app's credential store.
