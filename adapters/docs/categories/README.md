# Categories

Every plugin does one of five jobs, and lives in that job's folder under
`adapters/`. Its id is the folder path — `sources/jellyfin`, `iptv/stalker`,
`players/system`, `sync/custom-server`, `metadata/tmdb` — and its manifest
names the same category and declares that category's one block.

| Category | Its block | What the app does with it | Travels with |
| --- | --- | --- | --- |
| `sources` | `media` | shows its films, series and anime on Media, its videos and files on Videos | the account |
| `iptv` | `media`, with `live` | shows everything it brings on TV: Live, Movies, Series | the account |
| `players` | `player` | plays with it | the device |
| `sync` | `account` or `backup` | keeps the account there, or its backup | the device |
| `metadata` | `metadata` | asks it what a film or a series is, for watch status the app keeps | the account |

The app's Settings → Adapters has the same five lists, and shows only plugins
whose `platforms` include the one it runs on.

## Sources

Bring media: films, series, anime, web video, plain files. A source declares
`contentKinds`, what it brings:

| Kind | Meaning |
| --- | --- |
| `movies` | films |
| `shows` | series and their episodes |
| `anime` | anime, where a source distinguishes it |
| `videos` | web video — YouTube-style channels and uploads |
| `files` | plain files on a drive or a share |
| `live` | live channels, for a source with a tuner |

The plugin only states what it brings; where each kind is shown is the app's
decision. The media role connects (`plugin.media.connect`), lists in a given
order, opens titles, lists a show's seasons and a season's episodes, reports
what the user watched, resolves artwork, and — with playback — says what to
play.

A media server is the **master of its own watch state**: what each of its users
watched lives on the server. The app reads it through the media role
(`watchStateRead`), and writes progress back through it too
(`watchStateWrite`). That is why Jellyfin, Emby and Plex are sources and
nothing else.

Sources: `jellyfin`, `emby`, `plex`, `webdav`, `icloud-drive`, `google-drive`,
`onedrive`, `yattee`, `invidious`, and `mock` for development.

## IPTV

Bring live TV — channel groups, channels, a guide — and often a provider's own
films and series. An IPTV plugin uses the media role too, with `live` among its
kinds and the live members (`listChannelGroups`, `listChannels`, `getGuide`)
behind the `channels` and `epg` capabilities. Its films and series come through
the ordinary browse members.

Everything an IPTV plugin brings appears on the TV tab, in Live, Movies and
Series. Media and Videos never show IPTV content.

IPTV plugins run on iOS and Android. Portals rarely send CORS headers, and a
browser will not let a page send the cookie a Stalker portal needs, so they do
not claim `web` until something proxies them.

IPTV: `m3u`, `stalker`, `xtream`, and `mock` for development.

## Players

Play what a source or an IPTV plugin describes. A player plugin declares a
`player` block: one `PlayerProfile` per platform it runs on, saying what its
engine plays.

- `plugin.player.create(context)` returns the `MediaPlayer` that drives the
  engine.
- `PlayerView`, from `@loge/player-kit`, draws it.

Players are the one category that may use React, React Native and native code.

The app picks a player per item with `choosePlayer`. The device's default
comes first when it can play the item; then the others in order; and when none
can, the app says which one would. Players are device-wide: which are on, which
is the default, and their settings stay on the device.

Players: `system` (expo-video — AVPlayer, Media3/ExoPlayer, and the browser's
`<video>` with hls.js), `mpv` and `vlc` (Android and iOS), `ksplayer` (iOS).

## Sync

Decide where the account lives. A sync plugin declares one of two blocks:

- **`account`** — the account is kept there, and every device on it stays in
  step: your own server (`sync/custom-server`, PocketBase). Its connected
  provider moves records: every record on a pull, one all-or-nothing batch on
  a push. It may create an account (`signUp`), check the owner
  (`ownerProof`), and sign out.
- **`backup`** — a place to keep the account's encrypted backup file:
  `sync/icloud`, `sync/google-drive`, `sync/onedrive`. It stores bytes, with
  conditional writes, and knows nothing of what they hold.

Sync plugins are device-wide: each device chooses its own. Choosing one is an
account action, in Settings — never a side effect of adding a source.
For development, `sync/mock` plays at being your own server and
`sync/mock-backup` at being a backup target — two plugins, one block each.

## Metadata

Say what a film or a series *is*, by its name — for a source that does not.
A metadata plugin declares a `metadata` block, `identifies`: `movies`,
`shows`, or both. Its role connects (`plugin.metadata.connect`) and answers
one question, `identify({ type, title, originalTitle?, year })`, with a
catalogue's ids — `{ tmdb: '603' }` — or nothing where no match is close
enough to be sure of.

The app asks it about the films and series of an IPTV provider whose watch
status it keeps, that carry no catalogue id of their own: a portal keeping a
copy of a film for each language, each under its own name. Watch status is
keyed by what a thing is (`watchIdentity`), so once each copy carries the
same id, watching one checks every other. A wrong answer is worse than none
— it would merge two films' watch status — so a metadata plugin answers only
when it is sure.

It brings nothing to any tab. Its connections are account-wide, like a
source's: the household's own key, set up once, on every device.

Metadata: `tmdb`.

## One service, two jobs

Google Drive can hold your films and keep your backup. Those are two plugins,
`sources/google-drive` and `sync/google-drive`, each signed in on its own.

- Adding one never switches on the other.
- They share no code: a plugin never imports another plugin.
- If they ever need the same client, it becomes its own package.
