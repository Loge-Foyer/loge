# Google Drive

Video files from Google Drive.

## Category

**Source** — `sources/google-drive`, in `plugins/sources/google-drive`. Its
files show on the Videos tab, and its connections belong to the account.

Keeping the account's backup in Drive is another plugin, `sync/google-drive`.
The two sign in separately, each asking Google only for what its job needs,
and adding one never switches on the other.

## Brings

Files — video files on Google Drive.

## Connection

No fields yet: signing in is an OAuth flow (PKCE), with a client id per
platform, which arrives with the implementation. Tokens go to the credential
store.

## Platforms

iOS, Android and the web.

## Status

Manifest only. No media role yet, so no capability is declared.

See `docs/writing-a-plugin/` at the repository root.
