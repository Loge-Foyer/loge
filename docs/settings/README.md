# Settings

A plugin asks for input in two lists, and the app's Settings screen renders
both from the manifest. Nothing about a plugin is hard-coded in the app.

## Connection fields

What a connection needs — a server address, an account, a token. Shared by
every role of the plugin.

| `type` | Rendered as | Notes |
| --- | --- | --- |
| `text` | text input | `required`, `placeholder`, `default`, `credential` |
| `url` | URL input | same as `text`, without `credential` |
| `password` | masked input | the only secret type; no `default`; never shown again once saved |
| `boolean` | switch | `default` required |
| `select` | picker | `options` and a `default` that is one of them |

**`password` is the only secret.** The app sends those values to its credential
store and keeps an opaque `credentialsRef` on the connection, plus the names of
the saved secrets. Everything else is stored in plain text — so
`validateManifest` rejects a non-password field whose key looks like a secret
(`apiToken` declared as `text`).

**`credential: true`** marks a text field that is part of the account on the
other side — a username. It decides what "separate credentials per profile"
separates. Password fields always count as credentials. Only a connection field
can be one.

## Settings

Plain values and toggles: `text`, `url`, `select`, `boolean`, and `libraries`.
**A setting can never be a `password`** — settings live in a plain database
column, and the type system refuses a password there.

A boolean setting may **gate** capabilities:

```ts
{
  key: 'cacheMetadata',
  label: 'Keep metadata on this device',
  type: 'boolean',
  default: true,
  gates: ['media.offlineMetadata'],
}
```

- A toggle gates capabilities of one role only.
- **Every sync toggle defaults to off**, and every declared sync capability
  needs one. Connecting a plugin to watch films must never start sending your
  viewing state anywhere.

### `libraries`

```ts
{ key: 'libraries', label: 'Libraries to show', type: 'libraries', default: { mode: 'all' } }
```

A choice among the libraries the source itself reports:

- `{ mode: 'all' }`
- `{ mode: 'only', ids }`
- `{ mode: 'except', ids }` — this one also shows libraries the source adds
  later

The app fills the list by asking the connection (`getLibraries`), so the plugin
must declare the `libraries` capability, and there is at most one such setting.
The plugin applies the selection itself in `listItems` and `getResume`;
`selectsLibrary()` in `api` answers "does this library pass?".

## Per profile

Every connection belongs to the device. Its `perProfile` mode says what each
profile keeps for itself, and the form shows profile tabs above the first field
that differs per profile:

| Mode | Kept per profile |
| --- | --- |
| `none` | nothing: every profile uses the same values |
| `credentials` | credential fields and every password |
| `all` | every connection field and every setting |

`perProfileModes(manifest)` lists the modes worth offering — `credentials` only
when some field is a credential. A profile whose required per-profile values
are missing is *not set up*: the connection is simply not live for it.

## Role switches

Besides settings, each connection has a switch per declared role. A new
connection starts with media on, and sync on only when sync is the plugin's
single role — adding a sync-only plugin *is* the opt-in, and its capability
toggles still start off.
