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
production one.

## Installed per device

A plugin does nothing until someone installs it on the device — in Settings,
*All plugins*. What happens next depends on one switch per plugin, **Configure
per profile**, which starts off:

- **Off** — the plugin's connections belong to the device and every profile
  sees them. One Jellyfin server for the whole household.
- **On** — each profile sets up its own, for example everyone's own account.
  The shared connections are kept, just not used, until the switch goes off
  again.

A plugin can have several connections either way — two Jellyfin servers are
normal.

## What a plugin brings

Each plugin says what its media role brings — movies, shows, anime, videos or
files — and the app decides where that appears:

| Tab | Kinds |
| --- | --- |
| Media | movies, shows, anime — one library across every source |
| Videos | videos, files — one tab per source |

That mapping lives in one place, `src/services/tab-content.ts`. Nothing in the
app ever asks *which* plugin a source is.

## Forms come from the plugin

What a connection needs — a server address, a username, a password — is
declared in the plugin's manifest, and the connection screen renders exactly
that. Passwords go to the credential store and are never shown again; everything
else is plain configuration.

## The rules, enforced

Lint fails if anything outside `src/composition/` imports a plugin, a
repository implementation or a platform module. See the `sc-verify` skill for
how to prove the rules still bite.
