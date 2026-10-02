# Capabilities

Two levels, and the difference matters.

**Declared** capabilities are static, in the manifest: what a plugin *can* do.
**Effective** capabilities are per connection and per profile: what the user
has allowed it to do. The app branches on effective, always — branching on
declared would call features the user switched off.

## The rule

`effectiveCapabilities(manifest, { enabled, settings })` computes it, so the
app and anything else agree on one definition:

- A connection that is **switched off** (`enabled: false`) has nothing in
  effect.
- A declared **capability** is in effect when every toggle that gates it is on
  — the stored value, or the toggle's default when nothing is stored.
- A capability no toggle gates is in effect whenever its connection is.
- `settings` are the ones the connection runs with **for a profile**
  (`resolveValues`). A connection that keeps every setting per profile can
  cache metadata for one profile and not another.

Players and sync plugins have no capabilities of this kind.

- **A player's** manifest says what its engine plays instead: its
  `PlayerProfile` per platform.
- **An account or backup target** has a fixed set of members: every one listed
  in `ACCOUNT_MEMBERS` or `BACKUP_MEMBERS` must exist.

## The media capabilities — sources and IPTV

| Capability | Means | Provider members |
| --- | --- | --- |
| `browse` | It lists titles of the kinds it brings, and opens them | `listItems`, `getItem`, `getChildren` |
| `feed` | It can answer with the newest from a set of channels, in one call | `listFeed` |

`getItem` may also fill `MediaDetail.versions` — what the file is: codecs,
resolution, HDR, languages, size. **That is not a capability**, and
deliberately so: `browse` already promises `getItem`, and `versions` is
optional data on its answer. A screen shows the summary when there is
something to say and nothing when there is not, so a source that cannot report
files costs nothing. Absent is "the source did not say", never "there are
none" — which is why an empty list is wrong and `undefined` is right.

The same holds for `MediaDetail.creator` — the channel behind a video — and
`MediaDetail.sections`, the sections a channel keeps its children in
(videos, shorts, live, playlists). `getChildren` then takes a `ChildQuery` —
a section and the previous page's cursor — and answers with `nextCursor`
while there is more; a source with neither sections nor pages ignores it.

**Search is narrowed by the manifest, not a capability.** A source whose
search can answer with only videos, only channels or only playlists lists
them in `media.searchScopes` (`all`, `video`, `channel`, `playlist`), and
honours `ItemQuery.scope`; `validateManifest` refuses scopes without `search`.
The app shows the choice beside the box only for such a source.

| `libraries` | It has libraries the user can choose between | `getLibraries` |
| `watchStateRead` | Items carry what the user watched there; there is a resume list | `getResume` |
| `remoteImages` | Items carry artwork | `resolveImage`, `resolveHeaders` |
| `channels` | It brings live channels, in groups | `listChannelGroups`, `listChannels` |
| `epg` | It has a guide for those channels | `getGuide` |
| `playback` | It can say what to play for an item | `getPlaybackDescriptor` |
| `offlineMetadata` | Items keep stable ids and tag-versioned artwork, so the app may keep them on the device | none — a permission, not a call |
| `watchStateWrite` | It takes progress and played state back | `reportPlayback`, `setPlayed` |
| `search`, `collections`, `playlists`, `favoritesRead`, `favoritesWrite` | Named now, promised by nobody yet | arrive with their first implementation |

`MEDIA_CAPABILITY_MEMBERS` in `api` is that table in code. What is live is a
content kind, `live`, not a capability.

## Declare honestly

Capabilities are not documentation.

- **Media:** declaring `browse` means the app calls `listItems`. If that
  throws, every row shows an error for that source.
- **Players:** a profile that claims MKV sends the user to a black screen
  instead of the player that would have played it.
- **Accounts:** a server that stores half a batch and answers "stored" loses
  the rest, silently.

So a capability is declared in the same change that implements it. The
conformance test (`test/manifests.test.ts`) does three things:

- **It connects every plugin that has a media role**, with a fake context, and
  checks that each declared capability's members exist.
- **Without an implementation, nothing may be declared.** A plugin with no
  media role declares no media capability.
- **Every block has its role:** a `player` block needs `plugin.player`, an
  `account` block needs every `ACCOUNT_MEMBERS` member, and a `backup` block
  every `BACKUP_MEMBERS` one. An `ownerProof` needs `verifyOwner`, and a
  `signUp` needs `createAccount`.

`mock` declares a deliberately partial set, so the app's capability handling
is exercised rather than assumed.
