# Mock

A pretend media server with a deterministic catalogue, so the whole app can be
built and exercised with no network at all. Development builds only.

## Category

**Source** — `sources/mock`, in `plugins/sources/mock`. The mock's other jobs
are plugins of their own:

| Plugin | Job |
| --- | --- |
| `sources/mock` | the catalogue below |
| `sync/mock` | a pretend account (`plugins/sync/mock`) |
| `sync/mock-backup` | a pretend backup target (`plugins/sync/mock-backup`) |
| `iptv/mock` | channels, groups, a guide and a little VOD for the TV tab (`plugins/iptv/mock`) |

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

One field of each type a connection form renders:

- a library name (text)
- an endpoint (URL) — ignored
- a username marked as a credential, so the per-profile modes can be tried
  offline
- an optional password, which exercises the credential store
- a catalogue size (select)

## Settings

- *Simulated latency* — `slow` waits 1.5 s through the injected clock; `flaky`
  fails every third call with a retryable error.
- *Libraries to show*.

It deliberately does **not** declare every capability: a mock that can do
everything lets broken capability handling go unnoticed. It declares
`browse`, `libraries` and `watchStateRead`, and declines the rest. It has no
artwork (`remoteImages`), so the app's placeholders get exercised, and it
declines `offlineMetadata` and `search` as well.

## Status

The media role is implemented.

See `docs/writing-a-plugin/` at the repository root.
