---
name: sc-plugin-categories
description: Decide which category a Streaming Center plugin belongs in — sources, iptv, players or sync — and split a service that does two jobs into two plugins. Use before adding a plugin for a service that already has one, when a plugin should start doing a second job, or when unsure where something goes.
---

# Which category, and when to split

Every plugin does one job, in one folder:

| Category | Job | Block | Scope | Examples |
| --- | --- | --- | --- | --- |
| `sources` | brings films, series, anime, videos, files | `media` | account | Jellyfin, Plex, WebDAV, Google Drive's files |
| `iptv` | brings live TV, and a provider's films and series | `media` with `live` | account | Stalker, Xtream, M3U |
| `players` | plays | `player` | device | the built-in player, and mpv |
| `sync` | keeps the account, or its backup | `account` or `backup` | device | your own server, iCloud or Drive backups |

## The service already has a plugin, and should do a second job

**Do not add a second block to the existing manifest.** `validateManifest`
refuses it, and the conformance test does too. Create a second plugin in the
second job's folder:

```
adapters/sources/google-drive/     files from Drive          @sc/source-google-drive
adapters/sync/google-drive/        the backup file on Drive  @sc/sync-google-drive
```

Why two plugins, when it is one service:

- **Each list in Settings stays honest.** Sources shows sources, Sync shows
  places for the account. A plugin that sits in two lists makes both harder to
  read.
- **Adding one never switches on the other.** Connecting Drive to watch its
  files must never change where your account lives. Two plugins make that
  structural, not a rule someone has to remember.
- **Each asks only for what its job needs.** The source reads files; the
  backup target writes one file in its own folder.

They share no code — a plugin never imports another. If they need the same
client, it becomes its own package that both depend on.

## Media servers are sources, and only sources

Jellyfin, Emby and Plex master what their users watched. Reading that is
`watchStateRead`; writing progress back is `watchStateWrite`. Both are media
capabilities, and both go through the media role.

Never make `adapters/sync/jellyfin`: the account keeps profiles and sources,
not a media server's watch status. Nothing is mastered twice.

## Between sources and IPTV

- **It is a source** when it is a library you own or run: a media server, a
  share, a drive, a web-video front end. A source's `live` kind — a server with
  a tuner — also shows on TV.
- **It is IPTV** when it is a provider's service built around channels: a
  portal, an Xtream account, an M3U playlist. Everything it brings, films and
  series included, shows on the TV tab only.

## Between players and everything else

A player is the only plugin that draws, so it is the only one that may use
React, React Native and native code. A plugin that needs a native API but does
not draw — iCloud Drive's container — is still a source or a sync plugin. It
needs an Expo module of its own, and its `platforms` say where that module
exists.

## Checklist when splitting

1. **Create the new plugin** with `sc-add-plugin`, in the second category's
   folder, with its own manifest, block, fields and README.
2. **Leave the existing plugin's manifest alone,** apart from its README. Its
   connections keep working untouched.
3. **Declare only what the new plugin really does.** A backup target that
   cannot write conditionally is not a backup target yet.
4. **Update the roster:**
   - `../.claude/streaming-center-architecture.md` section 8
   - the tables in this repository's `AGENTS.md` and `README.md`
   - the category's list in `docs/categories/`

## Moving a plugin to another category

Connections store their plugin's id, and the id says the category, so moving
means an id change in every stored connection. Do not do it lightly. It is a
numbered migration in the app, the way Phase 6's v3 rewrites every id once.

## Verify

```bash
npm run typecheck
npm test
```

And in the app, confirm it branches on the plugin's **category** and its
**effective** capabilities — never on its name, and never on declared
capabilities alone.
