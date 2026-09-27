# Mock

A pretend server with a deterministic catalogue, so the whole app can be built and exercised with no network at all. Carries a sync role too, so syncing can be tested end to end without a real destination.

## Roles

**Media** — implemented. **Sync** — implemented: a pretend account.

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

It deliberately does **not** declare every capability. A mock that can do
everything lets broken capability handling go unnoticed. For media it declares
`browse`, `libraries` and `watchStateRead`, and declines the rest. It has no
artwork (`remoteImages`), so the app's placeholders get exercised; it declines
`offlineMetadata` and `search` as well. As an account it carries profiles,
preferences and connections, and declines the rest — `sealedPasswords` among
them, so connections reach other devices with only the names of their
passwords, and the app's way of asking for them stays exercised.

## The pretend account

Choose the mock as the device's account, and it keeps a pretend one in memory:

- **One per endpoint.** Every connection in the running app with the same
  endpoint shares one; `mock://household` starts with two profiles, Sam (PIN
  1234) and Robin.
- **Like a real account.** It stores each change once however often it is
  sent, answers the prefix it stored, and returns the whole log in its order —
  the sender's own changes too — fifty at a time.
- **Forgets on reload**, and then answers an old cursor with `reset`, which is
  how the app's way back from a lost account gets exercised.
- *Flaky* stores only half of every third push; *slow* waits 1.5 s on every
  call. Its owner check always passes, and asks for no proof.

It has no network, so it cannot link two devices: the app's two-device tests
share one account in memory, and real devices wait for the sync server.

## Status

Both roles are implemented.

See `docs/writing-a-plugin/` at the repository root.
