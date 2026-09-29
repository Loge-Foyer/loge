# Your own server

The account for someone who wants neither Apple nor Google: a server they run
themselves (`streaming_center_sync`). It keeps the household's account — its
profiles, their PINs and preferences, and its sources and IPTV connections
with their passwords — so every device signed in to it has the same.

## Category

**Sync**, with an `account` block — `sync/custom-server`, in `plugins/sync/custom-server`. Device-wide: each device chooses its own account.

## Connection

- **Server address** — required. The base every route hangs off; a query, a
  fragment and a trailing slash are dropped, a base path is kept.
- **Username** — required, and part of the sign-in (`credential`).
- **Password** — required, stored as a secret in the device's keychain.

**Creating an account** takes one more field, `invite`: a code from the
server's `invite` command, good for one account.

## From Phase 6: PocketBase, used as it is

The server becomes PocketBase, and this plugin speaks its own API.

- **Signing in** is PocketBase's password sign-in, over TLS.
  - The session token is kept in the device-bound session store, and
    refreshed on every sync.
  - When a session ends — 30 days offline, or the password changed — the
    plugin signs in once with the saved password. A refusal is latched and
    never tried again by itself.
  - A throttled sign-in waits (`backoff`, `too-many-attempts`): nothing judged
    the password.
- **Reading and writing:**
  - `pull` lists every record of the account.
  - `push` sends one batch, all or nothing, parents first. It answers which
    write the server refused, if any: over the profile limit, deleted, or
    malformed.
- **Record ids** are derived from the account and the app's own ids, so a
  resent write updates the same record, and two accounts on one server never
  collide.
- **Passwords travel in plain text**, in `secrets`, because the server is the
  household's own. A name listed without a value keeps the one stored: a device
  that lacks a password never erases it.
- **The owner check** (`verifyOwner`, `ownerProof: ['password']`) signs in with
  the password typed again, never the saved one.
- **Creating an account** calls the server's sign-up route with the invite,
  and with `firstProfile` when the device has no profiles of its own to
  upload.

## Today: Phase 4's zero-knowledge sign-in

Until Phase 6, this plugin speaks to the Phase 4 server:

- **It never sends the password.** The device derives a proof and a wrap key
  from it with PBKDF2 and HKDF.
- **Passwords are sealed.** Connections' passwords are sealed with a vault
  key that only the password opens.
- **The server keeps a change log** per account.

Phase 6 retires all of this, for now; the code stays in git.

## Status

Phase 4's sync role is implemented and tested against a fake of that server's
routes (`test/custom-server.test.ts`); `streaming_center_sync` runs it against
the real server. The PocketBase version arrives in Phase 6.

See `docs/writing-a-plugin/` at the repository root.
