# Settings

A plugin asks for input in two lists, and the app's Settings screen renders
both from the manifest. Nothing about a plugin is hard-coded in the app.

## Connection fields

What a connection needs — a server address, an account, a token. One list per plugin: one connection has one endpoint and one set of
credentials.

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

- A toggle gates media capabilities (`media.…`): the ones its plugin's block
  declares.
- A capability no toggle gates is in effect whenever the connection is on.

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

A source's or an IPTV plugin's connections belong to the account, so every
device on it has them. Each one's `perProfile` mode says what each
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

## On or off

Besides its settings, each connection has one switch, `enabled`. Switched off,
it stays configured and nothing of it is used, on any device of the account.

A player has no connection: it is on or off on each device, with its
settings. A sync plugin's connection stays on its device too: your server's
address and sign-in, or a backup target. It is chosen in Settings as the
account's home, or as its backup's, and never by adding a source.

Until Phase 6, connections still carry Phase 4's role switches instead.
