# Mock

A pretend server with a deterministic catalogue, so the whole app can be built
and exercised with no network at all. Development builds only.

## Category

In Phase 6 this folder becomes three plugins, one per job:

| Plugin | Category | Job |
| --- | --- | --- |
| `sources/mock` | source | the catalogue below |
| `iptv/mock` | IPTV | channels, groups, a guide and a little VOD, for the TV tab (Phase 7) |
| `sync/mock` | sync | a pretend account on "your own server", and a pretend backup target |

Today it is one plugin with Phase 4's two roles, media and sync.

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
- an endpoint (URL) — ignored for media; as an account, it names the pretend
  account
- a username marked as a credential, so the per-profile modes can be tried
  offline
- an optional password, which exercises the credential store
- a catalogue size (select)

## Settings

- *Simulated latency* — `slow` waits 1.5 s through the injected clock; `flaky`
  fails every third call with a retryable error.
- *Libraries to show*.

It deliberately does **not** declare every capability: a mock that can do
everything lets broken capability handling go unnoticed.

- **As a source,** it declares `browse`, `libraries` and `watchStateRead`, and
  declines the rest. It has no artwork (`remoteImages`), so the app's
  placeholders get exercised, and it declines `offlineMetadata` and `search`
  as well.

## The pretend account

Today, Phase 4's: a pretend account in memory, per endpoint, that stores each
change once, answers the prefix it stored, and returns its log in order.

From Phase 6, `sync/mock` plays at being your own server:

- **Records, not a log.** Soft deletes, and a profile limit.
- **One account per endpoint.** Every connection with the same endpoint
  shares one; `mock://household` starts with two profiles, Sam (PIN 1234) and
  Robin.
- **It forgets on reload.** That is how the app's way back from a server that
  lost its data gets exercised.
- **A backup target,** in memory, with conditional writes.

It has no network, so it cannot link two devices. The app's two-device tests
share one fake account in memory, and real devices use your own server.

## Status

Media and Phase 4's sync role are implemented.

See `docs/writing-a-plugin/` at the repository root.
