# Mock portal

A pretend IPTV provider with a fixed lineup, so the TV tab can be built and
tested with no portal at all. Development builds only.

## Category

**IPTV** — `iptv/mock`, in `adapters/iptv/mock`. It runs in a browser too: it
has no portal to send it no CORS headers.

## Brings

Live TV, films and series — `live`, `movies` and `shows` — the same on every
run:

- **Channels:** 20 in five groups — News, Sports, Films, Kids, Music —
  numbered from 101, or 200 in the large lineup, to try paging and long lists.
  News and sports keep a week of catch-up.
- **A guide** for every channel: an hour-long programme, then a half-hour one,
  shifted per channel. It is worked out from the time, so any window of it
  agrees with every other.
- **Twelve films and five series**, with seasons of six episodes.

## Playing

Playback descriptors point at public test streams, all H.264 and AAC, so
browsing works offline and playing needs the network:

- most channels loop an HLS test stream as if it were live; the first of
  every four is a real live one
- the last channel of each group offers only raw MPEG-TS, which AVPlayer
  cannot play — so on an iPhone without another player the app's "needs
  another player" gets exercised; Media3, VLC and a browser (mpegts.js) play
  it
- films are MP4 files, and episodes HLS

## Connection

- a portal address (URL) — ignored
- an optional MAC address, kept as a password the way a real portal's is, so
  the credential store and redaction get exercised
- the lineup: a few channels, or many

## Settings

- *Programme guide* — on by default. Off, it gates `media.epg`, so the TV tab
  shows channels with no guide: that is what exercises a toggle's effect.
- *Simulated latency* — `slow` waits 1.5 s through the injected clock; `flaky`
  fails every third call with a retryable error.

It deliberately does **not** declare every capability. It declares `browse`,
`channels`, `epg` and `playback`, and declines artwork (`remoteImages`), watch
state (`watchStateRead`, `watchStateWrite`), `libraries`, `search` and
`offlineMetadata` — so the app's placeholders get used, and nothing is kept on
the device.

## Status

The media role is implemented, live members included.

See `docs/writing-a-plugin/` at the repository root.
