# Plugins

How the app discovers, registers and talks to plugins, and how to develop
against the plugins repository locally.

## Linking the plugins repository

The plugins live in `../streaming_center_plugins`, a separate repository, and
are linked in with `file:` dependencies — `@sc/api` and one `@sc/plugin-<id>`
per plugin. Install that repository first; plugin files resolve `@sc/api` from
its `node_modules`.

Metro only needs to be told to watch the folder (`metro.config.js`). Each
plugin takes `@sc/api` as a peer dependency, so there is exactly one copy of
the vocabulary in the app. `npm ls --all` reports `UNMET DEPENDENCY @sc/api@*`
under each linked plugin; that is how npm reports links outside the project,
not a missing package.

## Registering a plugin

`src/composition/plugins.ts` is the only file that names a plugin. Adding one is
an import and an entry in its list. The catalogue checks every manifest when the
app starts: a broken manifest stops a development build and is left out of a
production one. A plugin that implements a role exports it beside its manifest
(`plugin.media`); the catalogue hands it to the media service, and nothing else
ever holds it. A sync role (`plugin.sync`) goes only to the account service.

## Installed per device, configured per connection

A plugin does nothing until someone installs it on the device — in Settings,
*All plugins*. Its connections belong to the device too; a plugin can have
several, and two Jellyfin servers are normal.

Each connection decides what every profile keeps for itself, with **Separate
config per profile**:

| Mode | Each profile keeps | Typical use |
| --- | --- | --- |
| None | nothing: every profile uses the same values | one household account |
| Credentials | its own sign-in — the password fields and any field the manifest marks `credential` | an account per person on one server |
| All | its own value for every field and setting | different servers, or different libraries, per person |

The form only offers the modes the manifest can support. Under Credentials and
All, profile tabs sit right above the first field that differs per profile, and
each per-profile input shows the tab's avatar beside its label. Switching away
from None keeps the login with the profile doing the editing — the saved
password is moved, never shown — and every other profile signs in on its own
tab; saving warns before per-profile values would be discarded.

- **A profile that has not filled in its tab** sees "Finish setting up" on its
  Media tab, linking straight to its own tab of the form.
- **"Don't use for {profile}"** switches the connection off for that profile:
  its details are dropped and it neither sees the connection nor is asked to
  finish it. "Use for {profile}" brings it back.
- **A PIN-protected profile's tab** stays locked behind its PIN for the rest of
  the form, and so does switching it off, so a child cannot replace or remove a
  parent's sign-in.

## Asking the server, only when told to

**Test connection** and **Load libraries** are buttons, never an automatic probe
while someone types: a server may lock an account after a few failed sign-ins.
Each tries the selected tab's values as they stand in the form, on a provider
outside the pool with its own installation id, so a probe never ends a running
session. Results name the server and its version, or say what went wrong in
words.

A `libraries` setting renders as *All*, *Only these* or *All except these*, with
the server's libraries listed once loaded. Libraries the server no longer
reports stay chosen, in case they come back.

## What a plugin is given

Plugins have no host globals — `@sc/api` compiles against `lib: ["esnext"]`
alone — so everything reaches them through the `PluginContext` built in
`services/plugin-context.ts`, for a media source and the account alike:

| Port | What the app supplies |
| --- | --- |
| `http` | `platform/http-client.ts`: answers every status, fails only with a `TransportError` (`offline`, `unreachable`, `timeout`, `aborted`), times out reading the body too, and logs method, host, path, status and duration — never a query string, header or body |
| `credentials` | the password fields of this connection's scope, read from the credential store on demand |
| `session` | the scope's token, bound to the identity that signed in (see `docs/data`) |
| `network` | the network kind from `expo-network`; a browser only knows online or offline |
| `client` | app name and version, device name, and an installation id stable per device, connection and credential scope |
| `clock` | `now()`, and a `sleep()` that honours cancellation |

The installation id hashes a device key with the connection and scope. The
device key is made once per install — from the vendor id on iOS or the Android
id, at random on the web — and kept in the secure store that never moves to
another phone, so a restored backup signs in as a new device rather than as
this one. A server that keeps one token per device then keeps one per profile
that signs in, instead of each sign-in ending the last one's session.

## What a plugin brings

Each plugin says what its media role brings — movies, shows, anime, videos or
files — and the app decides where that appears:

| Tab | Kinds |
| --- | --- |
| Media | movies, shows, anime — one library across every source |
| Videos | videos, files — one tab per source |

That mapping lives in one place, `src/services/tab-content.ts`. Nothing in the
app ever asks *which* plugin a source is: it branches on the effective
capabilities of a resolved source.

## The account

The device's account is the one connection with its sync role on, and only the
account service switches that: signing in in Settings → Account (or at first
launch), never a connection form, and never by default. Signing in is the
opt-in, so the account carries everything its plugin declares — profiles and
their PINs, preferences, connections without their passwords — less any toggle
the plugin offers and the user switched off.

- **One provider, apart from the media one.** `services/sync/provider.ts`
  connects the account's sync role with its own session
  (`session:{id}:account`), so a connection that is a source and the account
  signs in twice without either ending the other. A sign-in is tried once, on a
  provider outside the pool, before anything is saved.
- **A plugin that can only be an account** — a sync server, say — has no
  connection form: its page offers "Use as your account", and its `new` route
  refuses. One that declares a sync role this build does not implement says it
  cannot be an account yet.
- **A build without the account's plugin** shows the account as unavailable,
  and can still sign out of it.

## Plugins run on Hermes

On iOS and Android, plugin code runs on Hermes, which lacks a few built-ins
that Node and browsers have — `Array.prototype.toSorted`, `Object.groupBy`,
`crypto.randomUUID`. Code using them typechecks and passes every test, then
throws on a phone. App lint rejects them in `src/`, and the plugins repository's
tests scan its sources for them.

## The rules, enforced

Lint fails if anything outside `src/composition/` imports a plugin, a
repository implementation or a platform module, and if anything outside
`src/platform/` imports `expo-local-authentication`. See the `sc-verify` skill
for how to prove the rules still bite.
