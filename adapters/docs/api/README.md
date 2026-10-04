# API

`@loge/api` is the vocabulary the app and every plugin are written in. It depends
on nothing — not React, not Expo, not the app — so any of them can use it
without learning about the others.

## What is in it

| File | What it defines |
| --- | --- |
| `category.ts` | The five categories — `sources`, `iptv`, `players`, `sync`, `metadata` — and whether each is account-wide or device-wide (`CATEGORY_SCOPE`). The platforms (`PlatformId`: `ios`, `android`, `web`) and `runsOn()`. `qualifiedPluginId()` and `categoryOfPluginId()`, for ids like `sources/jellyfin`. |
| `bytes.ts` | Bytes as text and back — base64, base64url, UTF-8 — written by hand, since a plugin has no `btoa` or `TextEncoder` and Hermes may lack them. |
| `ids.ts` | Branded IDs: `PluginId`, `UserId`, `ConnectionId`, `CredentialsRef`. A `UserId` is a string at runtime, but the compiler will not accept one where a `ConnectionId` belongs. |
| `content.ts` | `ContentKind` — what a source brings: `movies`, `shows`, `anime`, `videos`, `files` and `live`. |
| `capabilities.ts` | The media capability flags, and `CapabilityKey` (`'media.offlineMetadata'`), the form a setting uses to gate one. |
| `fields.ts` | The field descriptors a plugin uses to ask for input: `text` (optionally a `credential`), `url`, `password`, `boolean`, `select`, and the setting-only `libraries`. |
| `manifest.ts` | `PluginManifest` and `Plugin` — what a plugin package exports: the manifest, its category and platforms, the one block its category declares, and that block's implementation once it exists — the `attribution` a service's terms ask the app to show, and the `credits` for what it is built on, with `creditsOn` to pick a platform's. |
| `connection.ts` | `Connection` — one configured instance of a source or IPTV plugin, owned by the account — and `PerProfile`, which says what each profile keeps for itself. |
| `per-profile.ts` | Which keys a mode keeps per profile, the values one profile runs with (`resolveValues`), and whether a profile is set up (`isSetUpFor`). |
| `user.ts` | `AppUser` — a profile. |
| `effective.ts` | What a connection may actually do: declared capabilities, less what a toggle switched off. |
| `validate.ts` | `validateManifest()` — the rules every manifest must satisfy. |
| `media.ts` | `MediaItem` (movie, show, season, episode, and a video site's channel and playlist), `GlobalMediaKey`, `MediaDetail` — with the `Creator` behind a video and a channel's `ChildSection`s — `Person`, `Library`, `WatchStatus`, and opaque `ImageRef` / `HeadersRef`. Also what a file *is* — `MediaVersion` with its video, audio and subtitle streams, plus the `HdrFormat`, `SpatialAudio` and `SubtitleDelivery` vocabularies that `playback.ts` shares. |
| `live.ts` | `ChannelGroup`, `Channel`, `Programme`, and the queries for channels and the guide. |
| `time-zones.ts` | `TIME_ZONES`, every zone by the ids the platform's ICU knows; `zoneOffsetMs()` and `fromZoneWallClock()`, for a guide stamped on another clock than the one it was written in. |
| `countries.ts` | `COUNTRY_ZONES`, one zone per country, and `countryOf()` — a channel's country from its guide id's ending (`trt1.tr`), else a group's or its own name (`TR ✨ ULUSAL`, a flag, `GERMANY`), never a language's code (`AR` for Arabic). |
| `identity.ts` | What something is apart from any source — `watchIdentity()`, by catalogue id or, where a provider keeps each language's copy apart, its `plainTitle()` and year — and `identityHash()`, the short name a watch record's key carries. `bareTitle()` is a title without the provider's marks, as written, for a catalogue to look up; `titleKey()` is what two spellings of it share. |
| `query.ts` | `ItemQuery` with a search's `SearchScope` and a `genre`, `GenreQuery`, `ChildQuery` (a section and a cursor), `ItemPage`, the four sorts, `compareItems()` — the one ordering rule — `mergeSorted()`, and `genreKey()`, one genre across sources. |
| `playback.ts` | What to play: `PlaybackDescriptor` and its sources, audio and subtitle tracks; `PlayerProfile`, what an engine plays; `PlaybackRequest`; and `PlaybackReport`, what playing reports back to a source. |
| `player.ts` | The player role: `MediaPlayer`, `PlayerEvent`, `PlayerManifest`, and the pure `canPlay()`, `missingFor()` and `choosePlayer()`. |
| `errors.ts` | `AppError`: a code from the spec, a retry hint, and an optional reason. |
| `http.ts` | `HttpClient`, the port a plugin reaches the network through, and `TransportError`. |
| `crypto.ts` | `PluginCrypto`, the host's cryptography — random bytes, SHA-256, HKDF, AES-GCM. |
| `context.ts` | `PluginContext` and `PluginTarget` — what a plugin may use from its host, and the values it runs with. |
| `media-role.ts` | `MediaRole`, `ConnectedMediaProvider`, and `MEDIA_CAPABILITY_MEMBERS`. |
| `account.ts` | The account role: `AccountRecord` and its kinds, `AccountSnapshot`, `PushOutcome`, `AccountInfo`, `ConnectedAccount`, `recordKey()`, `recordId()` and `isAccountRecord()`, and `DEFAULT_MAX_PROFILES`. |
| `backup.ts` | The backup role: `ConnectedBackupTarget` — `stat`, `read`, `write` with `ifMatch`, `list`. |
| `metadata.ts` | The metadata role: `MetadataManifest` (`identifies`), `IdentifyQuery`, `ConnectedMetadataProvider` — `check`, `identify`, `dispose` — and `METADATA_MEMBERS`. |

`fixtures/account-records.json` holds records every side must accept or
refuse. The tests here read it, and so do the sync server's.

## The manifest

```ts
export const plugin: Plugin = {
  manifest: {
    id: pluginId('sources/jellyfin'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
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

- **`id`** — the category, then the name: the plugin's folder under
  `plugins/`.
- **`category`** — which list the plugin is in, and which one block it
  declares:
  - sources and IPTV: `media`
  - players: `player`
  - sync: `account` or `backup`
  - metadata: `metadata`
- **`platforms`** — where it runs. The app shows and runs a plugin only where
  it runs.
- **`contentKinds`** — what a source brings. The plugin states it; the app
  decides where each kind appears.
- **`connectionFields`** — what a connection needs: endpoint, account, secrets.
  The app's Settings screen renders them; it has no form of its own for any
  plugin.
- **`settings`** — plain values, capability toggles, and at most one
  `libraries` choice. See `settings/`.

## Connections

A connection is one configured instance of a source or IPTV plugin — "Jellyfin
Home". Two connections to the same plugin are normal. Every one belongs to the
account, so each device on the account has it. It records:

- whether it is switched on (`enabled`)
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
  - `crypto` — random bytes, hashing and sealing
- **Pages come in `compareItems` order.** The app merges several sources with
  that same function, and a plugin merges its own libraries with it.
- **Items are plain data**, connection-qualified, and carry the source's
  `watch` status. The source is the master of that status; the app caches it.
- **Artwork is an `ImageRef`** only the plugin can turn into an `ImageSource`,
  synchronously. Headers an image needs are resolved separately and never
  stored.
- **Live TV** — `listChannelGroups`, `listChannels` and `getGuide`, behind the
  `channels` and `epg` capabilities.
- **`getPlaybackDescriptor(request)`**, behind `playback`, says what to play
  for the engine the request describes. A descriptor lives in memory only: its
  addresses can carry credentials.
- **`reportPlayback(report)` and `setPlayed(key, played)`**, behind
  `watchStateWrite`, take progress and played state back to a source that
  masters them. The app's outbox delivers them, and may deliver one twice, so
  both are safe to repeat.

## Players

```ts
const choice = choosePlayer(descriptor.sources, enabledPlayers, devicesDefault);
if (choice.kind === 'play') {
  const player = plugins.get(choice.player).player.create(context);
  await player.load({ source: choice.source, startMs: descriptor.startMs });
}
```

- **`PlayerProfile`** says what an engine plays: protocols, containers,
  codecs, subtitle formats. A player plugin declares one per platform.
- **`choosePlayer`** prefers the device's default whenever it can play any
  source, then the others in order, and tries sources best first.
  `missingFor` names what stops an engine — a protocol, a container, a codec —
  so the app can say which player would do.
- **`MediaPlayer`** drives the engine and reports `PlayerEvent`s. Its view, the
  part that draws, is `player-kit`'s.

## The account contract

```ts
const account = await plugin.account.connect(target, context); // no network work yet
await account.status();                 // sign in, once
await account.push(records);            // one batch, all or nothing
const { records } = await account.pull(); // every record of the account
```

- **Records** are profiles, PINs, preferences, connections and profiles'
  values on them. Each has a kind, a key (`recordKey`), `deleted`, and its
  data.
  - Deletes are soft, and a deleted profile or connection stays deleted.
  - A connection's passwords travel in `secrets`, in plain text, because the
    server is the household's own. A name listed without a value keeps the
    stored one.
- **`push`** answers `stored`, or which write it refused and why: a profile
  over the limit, a write to something deleted, or a malformed record.
- **`pull`** returns everything. An account is small, so a device reads all of
  it every time, and conflicts are the app's to settle.
- **`info()`** gives the server's profile limit and how it takes sign-ups,
  without signing in. **`createAccount(fields, { firstProfile })`** takes the
  `signUp` fields. **`verifyOwner(proof)`** checks the `ownerProof` fields,
  typed again.
- **`isAccountRecord()`** checks anything that arrives; the app runs it on
  every record it reads.
- **`recordId()`** is a record's id on your own server: SHA-256 over the
  account's id, the kind and the key. Derived, never chosen, so a resent write
  lands on the same record — and the server derives the same for the profile
  it creates at sign-up.

## The metadata contract

```ts
const catalogue = await plugin.metadata.connect(target, context); // no network work yet
await catalogue.check();                                          // the key, tried once
await catalogue.identify({ type: 'movie', title: 'Der Pate', year: 1972 }); // { tmdb: '238' }
```

- **`identify`** answers with a catalogue's ids, or with nothing where no
  match is close enough to be sure of. The app keys watch status by them, so
  a wrong answer merges two films — none is always better.
- **The query is the source's title without its marks** (`bareTitle`): no
  "DE", no "4K", no "(1999)" — with the year that was in it, where the item
  had none of its own. `originalTitle`, where the source knows it, is asked
  first.
- **A refused key is latched** — `UNAUTHORIZED`, `retry: 'never'` — and a
  catalogue that counts requests answers `backoff`; the app then waits.

## The backup contract

A backup target stores bytes and nothing else: `stat`, `read`, `list`, and
`write(name, bytes, ifMatch)`, which refuses with `SYNC_CONFLICT` when the file
changed since `ifMatch`. The file's format and its encryption are the app's.
