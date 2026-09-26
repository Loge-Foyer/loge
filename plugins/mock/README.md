# Mock

A pretend server with a deterministic catalogue, so the whole app can be built and exercised with no network at all. Carries a sync role too, so syncing can be tested end to end without a real destination.

## Roles

**Media** — implemented. **Sync** — declared, not implemented yet.

## Brings

All five kinds — movies, shows, anime, videos and files — so every tab can be
built offline. Only films and series have titles so far; the other kinds return
empty pages until their phase.

## Catalogue

The same titles in the same state on every run:

- About 40 films (400 in the large catalogue), across 1972–2025. Some have only
  a year, and some have no rating.
- About 10 series (60 in the large catalogue), with seasons and episodes.
- Three libraries: Films, Series and Kids.
- Watch states, all fixed: watched, in progress, and series partly watched.

## Connection

One field of every type the app renders:

- a library name (text)
- an endpoint (URL)
- a username marked as a credential, so the per-profile modes can be tried
  offline
- an optional password, which exercises the credential store
- a catalogue size (select)

## Settings

- *Simulated latency* — `slow` waits 1.5 s through the injected clock; `flaky`
  fails every third call with a retryable error.
- *Libraries to show*.
- *Sync watch progress / favourites / watchlist*, off by default.

It deliberately does **not** declare every capability. A mock that can do
everything lets broken capability handling go unnoticed. For media it declares
`browse`, `libraries` and `watchStateRead`, and declines the rest. It has no
artwork (`remoteImages`), so the app's placeholders get exercised; it declines
`offlineMetadata` and `search` as well. For sync it declares `watchProgress`,
`favorites` and `watchlist`.

## Status

The media role is implemented. The sync role is a manifest until the sync phase.

See `docs/writing-a-plugin/` at the repository root.
