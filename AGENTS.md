# AGENTS.md — streaming_center_plugins

Every adapter Streaming Center has to the outside world, plus the vocabulary
they are written in. Read the workspace root `AGENTS.md` and
`../.claude/streaming-center-architecture.md` first.

---

## Shape

```
api/                     @sc/api — domain types + every contract. Depends on NOTHING
  fixtures/              records every side must judge alike (the Go server's tests read them too)
player-kit/              @sc/player-kit — the React half of the player contract (Phase 7)
plugins/
  sources/<name>/        jellyfin emby plex webdav icloud-drive google-drive onedrive yattee invidious mock
  iptv/<name>/           m3u stalker xtream mock
  players/<name>/        system ksplayer mpv vlc
  sync/<name>/           custom-server icloud google-drive onedrive mock mock-backup
test/                    vitest — api rules, plugins against fake HTTP, conformance
docs/
```

**Not here yet:** `player-kit` arrives with the first player (Phase 7).

npm workspaces (`["api", "plugins/*/*"]`, and `player-kit` when it exists),
source-only — `"exports": "./src/index.ts"`, no build step. Every plugin lists
`@sc/api` as a **peer** dependency: the host supplies the one instance, so
branded IDs from the app and from a plugin are the same type.

## One category per plugin

Every plugin has exactly one category, and its folder says which. The id is
that folder path: `sources/jellyfin`, `iptv/stalker`, `players/system`,
`sync/custom-server`.

| Category | Declares | Implements | Scope |
| --- | --- | --- | --- |
| `sources` | `media` (content kinds, capabilities) | the media role | account |
| `iptv` | `media`, with `live` | the media role, with live members | account |
| `players` | `player` (a profile per platform) | the player role and `player-kit`'s view | device |
| `sync` | `account` or `backup` | the account role or the backup role | device |

**A service with two jobs is two plugins.** Google Drive's files are
`sources/google-drive`; Google Drive as a backup place is `sync/google-drive`.
They share no code: a plugin never imports another. If two ever need the same
client, that client becomes a package of its own.

**Media servers are media-only.** A media server masters what its users
watched. The app reads it (`watchStateRead`) and later writes progress back
(`watchStateWrite`) through the media role — never through the account. Do not
create `plugins/sync/jellyfin`.

## Boundaries

| Package | May import | Must not import |
| --- | --- | --- |
| `api` | nothing | react, react-native, expo\*, any plugin, the app |
| `player-kit` | `@sc/api`, `react` (peer) | any plugin, the app |
| a sources, IPTV or sync plugin | `@sc/api` | any framework, the app, another plugin |
| a player plugin | `@sc/api`, `@sc/player-kit`, react, react-native, its engine (expo-video, or an Expo module in its own folder) | the app, another plugin |

`lib: ["esnext"]` gives `api` and every non-player plugin **no host globals**:
no `fetch`, `URL`, `console`, `setTimeout`, `btoa`, `AbortSignal`. The compiler
rejects them.

- A plugin reaches the host only through the context it is handed: `http`,
  `credentials`, `session`, `network`, `client`, `clock`, `crypto`.
- Bytes become text through `api`'s own helpers (`encodeBase64Url`,
  `encodeUtf8`…), never `btoa` or `Uint8Array.prototype.toBase64`. Hermes has
  neither.

Players compile in a program of their own, with React Native's types, because
an engine has to draw.

`api` is the centre of the whole project — the app depends on it, and every
plugin does. It must stay a leaf. If you need a capability there, declare an
interface and implement it outside.

The sync server is Go and cannot import `api`. The account records in
`api/src/account.ts` are its contract, and `api/fixtures/account-records.json`
is what both sides test against. Change them together.

---

## The manifest

Each plugin's `src/index.ts` exports `plugin: Plugin` — the same name
everywhere, so the app's registration line is always
`import { plugin as x } from '@sc/source-x'`.

```ts
interface PluginManifest {
  readonly id: PluginId;                         // 'sources/jellyfin'
  readonly category: PluginCategory;
  readonly platforms: readonly PlatformId[];     // where it runs; the app shows it only there
  readonly displayName: string;
  readonly description: string;
  readonly media?: { contentKinds: readonly ContentKind[]; capabilities: readonly MediaCapability[] };
  readonly player?: PlayerManifest;
  readonly account?: AccountManifest;
  readonly backup?: BackupManifest;
  readonly connectionFields: readonly Field[];
  readonly settings: readonly PluginSettingDescriptor[];     // never a password
}
```

It declares **exactly the one block its category needs**. `validateManifest()`
checks it, along with the rest; `npm test` runs it over every plugin.

- **`contentKinds`** — what a media role brings: `movies`, `shows`, `anime`,
  `videos`, `files`, `live`. The app decides where each kind appears, by
  category and kind; a plugin never names a tab.
- **`connectionFields`** — endpoint, account, secrets. The app renders them. A
  `password` field is the only secret — and anything that signs in on its own
  is a password field, whatever it looks like: a portal's MAC address, a
  playlist address with the sign-in in it. Mark a text field that is part of
  the account on the other side — a username — with `credential: true`: a
  connection that keeps credentials per profile keeps exactly those, plus
  every password.
- **A `libraries` setting** lets the user pick from the libraries the source
  reports. It needs the `libraries` capability, because the app fills it by
  asking the connection.
- **Capabilities** are declared with the code that honours them. The
  conformance test checks that every declared capability's members
  (`MEDIA_CAPABILITY_MEMBERS`) and every block's role exist.

### The media role — sources and IPTV

`plugin.media.connect(target, context)` returns a `ConnectedMediaProvider`. It
does no network work: signing in waits for the first call. The target holds
the connection's values already resolved for one profile.

| Capability | Members |
| --- | --- |
| `browse` | `listItems`, `getItem`, `getChildren` |
| `libraries` | `getLibraries` |
| `watchStateRead` | `getResume` (items carry `watch` too) |
| `remoteImages` | `resolveImage` (synchronous), `resolveHeaders` |
| `channels` | `listChannelGroups`, `listChannels` |
| `epg` | `getGuide` |
| `playback` | `getPlaybackDescriptor` |
| `offlineMetadata` | none — permission for the app to keep items on the device |

`check()` and `dispose()` are always present. Rules every provider follows:

- **Pages are ordered exactly by `compareItems(query.sort)`.** The app merges
  sources with it. Channels come in the provider's own order.
- **Sign-in is single-flight.** Several calls start together.
- **A refused login is never retried.** Servers lock accounts; portals too.
- **Throw only `AppError`**, with a retry hint: `backoff`, `network-change` or
  `never`.
- **A playback descriptor lives in memory only.** A stream address can carry a
  password (Xtream) or a session token (Stalker). Never put one in a log, a
  cache or a session.

### The player role

`plugin.player.create(context)` returns a `MediaPlayer`, framework-free: load,
play, pause, seek, tracks, and `PlayerEvent`s. The view that draws it is
`player-kit`'s `PlayerView`, exported from the same package.

- The manifest's `player.profiles` say, per platform, what the engine plays:
  protocols, containers, codecs, subtitle formats. `choosePlayer` in `api`
  reads them. Overstating one sends the user to a black screen, so state only
  what the engine really plays.
- A null engine that fails loudly is the right placeholder. A silent no-op
  turns "not implemented" into a mystery.

### The account role — your own server

`plugin.account.connect(target, context)` returns a `ConnectedAccount`:

- `info`, `status`, `pull`, `push`, `dispose`
- optionally `createAccount` (with the `account.signUp` fields), `verifyOwner`
  (with the `account.ownerProof` fields, typed again) and `signOut`

It moves `AccountRecord`s — profiles, PINs, preferences, connections, profiles'
values:

- **`pull`** returns every record of the account. An account is small.
- **`push`** sends one batch, all or nothing. It answers `stored`, or the write
  it refused and why.
- **Passwords travel in plain text**, in `secrets`, to your own server, for
  now.

### The backup role

`plugin.backup.connect(target, context)` returns a `ConnectedBackupTarget`:
`stat`, `read`, `list`, and `write(name, bytes, ifMatch)`, which refuses with
`SYNC_CONFLICT` when the file changed since that etag. It stores bytes and
nothing else. The file's format and encryption are the app's.

---

## Declared versus effective capabilities

The distinction that matters most in this repository.

- **Declared** — static, in the manifest. What the plugin *can* do.
- **Effective** — per connection and per profile. Declared ∩ what the user
  switched on.

The app branches on **effective**. A setting can gate a capability:

```ts
type PluginSettingDescriptor = TextField | UrlField | SelectField | ToggleSetting | LibrariesField;

interface ToggleSetting {
  readonly key: string;                        // 'cacheMetadata'
  readonly label: string;
  readonly type: 'boolean';
  readonly default: boolean;
  readonly gates?: readonly CapabilityKey[];   // 'media.offlineMetadata'
}
```

`effectiveCapabilities(manifest, { enabled, settings })` is the one
definition:

- A connection switched off has nothing in effect.
- A declared capability is in effect when every toggle gating it is on — the
  stored value, else the default.
- An ungated capability follows its connection.

---

## Non-negotiables

1. **Declare capabilities honestly.** They are not documentation; application
   code branches on them. Declaring `search` while `search()` throws turns
   every query into a `sourceError`. Not declaring it means the method is never
   called.

2. **Map at the boundary.** Remote payloads become domain types *inside* this
   package. No external type may appear in a return value. Anything the adapter
   needs on a later call goes in provider-scoped metadata nothing else reads.

3. **Secrets through the injected credential store.** A secret is a `password`
   connection field; the connection stores only an opaque `credentialsRef`.
   - Settings are a plain database column and cannot be `password` — the type
     refuses it, and `validateManifest` flags secret-looking keys on other field
     types.
   - Artwork or a stream that needs auth carries a `headersRef`, never an
     inline header.

4. **Normalize errors.** Throw `AppError` with a known code and a retry hint.
   A raw HTTP or transport error reaching the UI is a bug.

5. **Never assume you are the only connection.** Two connections to the same
   plugin are normal.

6. **One block, the category's.** A plugin with two jobs is two plugins. Never
   give a source an `account` block, or a sync plugin a `media` one.

7. **Say where you run.** `platforms` is honest: a plugin that needs iCloud's
   container is `['ios']`. A portal that sends no CORS headers is not `web`
   until something proxies it.

### The account role specifically

8. **`pull` is complete.** Every record of the account, deleted ones included.
   The app decides what to apply, and a record left out reads as lost.

9. **`push` is all or nothing.** Store the whole batch, or none of it and say
   which write stopped it. Never store half and answer "stored".

10. **Do not resolve conflicts.** The app's sync engine owns that.

11. **Never sign in again after a refusal by yourself.** A session that ends —
    expired, or the password changed — gets one sign-in with the saved
    password; a refusal is latched until the user acts.

---

## Changing `api`

It ripples into every plugin and into the app. Update `api`, then each plugin
implementing the changed contract, then the app. Commit each repository
separately.

An account record change also reaches the Go server. Update
`api/fixtures/account-records.json` in the same commit, and the server's
collections and tests in its own.

Nothing else enforces cross-repo consistency. Verify by hand.

If adding a plugin requires changing the app's screens, schema or services, the
abstraction in `api` is wrong — fix that instead of working around it. That is
the test of whether this architecture is real.

---

## Skills

`.agents/skills/` in this repository:

- **`sc-add-plugin`** — create a new plugin, in the folder for its category.
- **`sc-plugin-categories`** — which category a plugin belongs in, and how to
  split a service that does two jobs.
- **`sc-verify-plugins`** — verification, including the boundary greps and the
  cross-repository check after touching `api`.

---

## Current state

Phase 6 — the code is moving to the new architecture. The plugins are in
their category folders, with qualified ids, and the account is kept record by
record on your own server, PocketBase.

**`api` holds:**

- the manifest vocabulary, with categories, platforms, qualified ids and one
  block per category
- the media contract: `MediaItem` and friends, `ItemQuery` / `compareItems` /
  `mergeSorted`, live TV (`Channel`, `Programme`) and the playback members
- per-connection per-profile values (`PerProfile`, `resolveValues`,
  `isSetUpFor`)
- `AppError` with retry hints, and `HttpClient`
- playback: `PlaybackDescriptor`, `PlayerProfile`, `MediaPlayer`,
  `choosePlayer`
- the account role, record by record (`AccountRecord`, `isAccountRecord`), and
  the backup role
- the host's crypto port (`PluginCrypto`: random bytes, SHA-256, HKDF,
  AES-GCM), and bytes as text (`bytes.ts`)

**The plugins:**

- **`sources/jellyfin`** implements the media role.
- **`sources/mock`** implements it with a fixed catalogue.
- **`sync/custom-server`** implements the account role on PocketBase: one
  sign-in, latched refusals, the whole account read, batches written, sign-up
  with an invite, the password typed again as the owner check.
- **`sync/mock`** plays at being your own server in memory, and
  **`sync/mock-backup`** at being a backup target.
- **Every other plugin** is a manifest that declares no capability: IPTV,
  players with no profile, backup targets with no role.

Phase 4's roles (`effectiveRoles`, `defaultRoles`), its log-based sync role,
sealed passwords and the derived owner proof are retired, with PBKDF2 in the
crypto port.

## Verify

```bash
npm install
npm run typecheck
npm test
```
