# Settings

A plugin asks for input in two lists, and the app's Settings screen renders
both from the manifest. Nothing about a plugin is hard-coded in the app.

## Connection fields

What a connection needs — a server address, an account, a token. Shared by
every role of the plugin.

| `type` | Rendered as | Notes |
| --- | --- | --- |
| `text` | text input | `required`, `placeholder`, `default` |
| `url` | URL input | same as `text` |
| `password` | masked input | the only secret type; no `default`; never shown again once saved |
| `boolean` | switch | `default` required |
| `select` | picker | `options` and a `default` that is one of them |

**`password` is the only secret.** The app sends those values to its credential
store and keeps an opaque `credentialsRef` on the connection. Everything else is
stored in plain text — so `validateManifest` rejects a non-password field whose
key looks like a secret (`apiToken` declared as `text`).

## Settings

Plain values and toggles: `text`, `url`, `select`, and `boolean`. **A setting can
never be a `password`** — settings live in a plain database column, and the type
system refuses a password there.

A boolean setting may **gate** capabilities:

```ts
{
  key: 'syncWatchProgress',
  label: 'Sync watch progress',
  type: 'boolean',
  default: false,
  gates: ['sync.watchProgress'],
}
```

- A toggle gates capabilities of one role only.
- **Every sync toggle defaults to off**, and every declared sync capability
  needs one. Connecting a plugin to watch films must never start sending your
  viewing state anywhere.

## Role switches

Besides settings, each connection has a switch per declared role. A new
connection starts with media on, and sync on only when sync is the plugin's
single role — adding a sync-only plugin *is* the opt-in, and its capability
toggles still start off.
