# Your own server

The account for someone who wants neither Apple nor Google: a Streaming Center
sync server they run themselves (`streaming_center_sync`). It carries the
household's profiles, their PINs and preferences, and connections — with
their passwords, sealed on the device.

## Roles

**Sync** — implemented. No media role.

## Connection

- **Server address** — required. The base every route hangs off; a query, a
  fragment and a trailing slash are dropped, a base path is kept.
- **Username** — required, and part of the sign-in (`credential`). Compared as
  the server compares it: NFC, lower case.
- **Password** — required, stored as a secret. It never leaves the device.

**Creating an account** takes one more field, `invite`: a code from
`sc-sync invite` on the server, good for one account.

## The keys

The device derives everything from the account password and never sends it:

```
password ─ PBKDF2-SHA256 (the account's salt, 600k iterations) ─ master
master ─ HKDF "sc/custom-server/v1/proof" ─ proof   → the server keeps SHA-256 of it
master ─ HKDF "sc/custom-server/v1/wrap"  ─ wrap    → never leaves the device
vault key (32 random bytes) ─ AES-GCM(wrap) ─ the wrapped vault key → kept by the server, opaque
```

- **Signing in** asks for the account's parameters, refuses any under
  `isKdfParams`' floor before deriving, and sends the proof. The answer carries
  the wrapped vault key, which only the password opens; `vaultKey()` hands it
  to the app, which seals connections' passwords with it.
- **The owner check** (`verifyOwner`, `ownerProof: ['password']`) derives from
  the password typed again, with the parameters kept from signing in, and
  sends that proof — never the saved password.
- **Creating an account** makes a fresh salt and vault key, sends the proof and
  the wrapped key with the invite, and refuses a password under 10 characters
  before asking.

## The session

Kept in the account's session, in the device-bound store: this device's token,
the vault key and the key's parameters.

- With none — the first call, or after a restore — it signs in once, shared by
  every caller. A caller's signal stops its own wait, never the shared sign-in.
- A refused sign-in is remembered, and never tried again by this provider. A
  throttled one (`429`) waits (`backoff`, `too-many-attempts`): nothing judged
  the password.
- **A 401 on a call with a token means the server let this device go** —
  `sc-sync revoke`, or its account deleted. It tries a newer token this device
  saved meanwhile, once; otherwise it leaves a tombstone, answers every call
  with `UNAUTHORIZED` / `signed-out`, and never signs itself back in: that would
  undo a revoke. Only the user signs in again.
- `signOut()` lets this device's token go at the server, once, and never signs
  in to do it.

## The log

`pull` passes the server's cursor through and leaves out any change the
contract does not allow. `push` sends requests of at most 4 MiB and 1,000
changes; the accepted prefix runs across them, and a request that stores less
than it was sent ends the push. One that fails after others stored answers
what they stored.

## Status

The sync role is implemented and tested against a fake of the server's routes
(`test/custom-server.test.ts`); `streaming_center_sync` runs it against the
real server.

See `docs/writing-a-plugin/` at the repository root.
