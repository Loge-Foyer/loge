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

- *Simulated latency* — `slow` waits 1.5 s; `flaky` stores only half of every
  third push.

## How it behaves

Today it is Phase 4's pretend log:

- it stores each change once, however often it is sent
- it answers with the prefix it stored
- it returns the whole log in order
- it forgets on reload, and then answers an old cursor with `reset`

It declines sealed passwords on purpose. In Phase 6's S3 it becomes a pretend
PocketBase account, record by record, with soft deletes and a profile limit.

It has no network, so it cannot link two devices.
