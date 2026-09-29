# Google Drive

Google's storage. It does two jobs for the app, so in Phase 6 this folder
becomes two plugins:

| Plugin | Category | Job | Platforms |
| --- | --- | --- | --- |
| `sources/google-drive` | source | video files from Drive, on the Videos tab | iOS, Android, web |
| `sync/google-drive` | sync | a place for the account's encrypted backup file, in a visible "Streaming Center" folder, saved after changes and opened on another device | iOS, Android, web |

They sign in separately — each asks Google only for what its job needs — and
adding one never switches on the other.

## Brings

Files — video files on Google Drive (`sources/google-drive`).

## Connection

No fields: signing in is an OAuth flow (PKCE), with a client id per platform,
which arrives with the implementation. Tokens go to the credential store.

## Status

Manifest only, and still Phase 4's single `google` plugin with two empty
roles. No role is implemented, so no capability is declared. The backup target
is planned for after the players (Phase 9's list).

See `docs/writing-a-plugin/` at the repository root.
