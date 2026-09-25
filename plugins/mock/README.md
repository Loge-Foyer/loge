# Mock

A pretend server with a deterministic catalogue, so the whole app can be built and exercised with no network at all. Carries a sync role too, so syncing can be tested end to end without a real destination.

## Roles

**Media** — exposes content. **Sync** — carries your user state.

## Brings

All five kinds — movies, shows, anime, videos and files — so every tab can be
built and exercised offline.

## Connection

One field of every type the app renders: a library name (text), an endpoint
(URL), an optional password (it exercises the credential store) and a catalogue
size (select).

## Settings

Exposes toggles for every gateable capability, so tests can flip them and confirm the app honours the effective set rather than the declared one: *Report playback progress* (gates `media.watchStateWrite`, on by default) and *Sync watch progress / favourites / watchlist* (off by default), plus a *Simulated latency* select.

It deliberately does **not** declare every capability. A mock that can do everything lets broken capability handling go unnoticed. It declares `home`, `libraries`, `watchStateRead`, `watchStateWrite`, `remoteImages` for media and `watchProgress`, `favorites`, `watchlist` for sync — and declines the rest, `search` and `favoritesWrite` included.

## Status

Manifest only: the catalogue and both role implementations are still to come.

See `docs/writing-a-plugin/` at the repository root.
