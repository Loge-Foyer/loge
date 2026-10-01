# Mock account

A pretend account for development, held in memory and keyed by its endpoint, so
the account's flows can be exercised with no server at all.

## Category

**Sync** — `sync/mock`. Development builds only.

## Connection

- **Endpoint** — names the pretend account. Every connection in the running app
  with the same endpoint shares one; `mock://household` starts with two
  profiles, Sam (PIN 1234) and Robin.

## Settings

- *Simulated latency* — `slow` waits 1.5 s; `flaky` fails every third push
  before storing anything, as a busy server would.

## How it behaves

It plays at being your own server, record by record:

- a push is stored all or nothing, and refused as your server refuses one —
  over the profile limit (ten), a deleted profile or connection written again,
  or a record the api does not allow
- a deleted profile or connection stays deleted, and a tombstone keeps no data
- a password a write lists without its value keeps the stored one
- `pull` returns every record, tombstones included
- signing up is open, with no invite; `firstProfile` adds a profile named You
- the owner check vouches without asking: there is nothing to type

It forgets on reload, and the devices then put back what it lost, as they
would for a server restored from an old backup. It has no network, so it
cannot link two devices.
