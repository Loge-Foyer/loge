# iCloud

Apple's storage. It does two jobs for the app, so in Phase 6 this folder becomes
two plugins:

| Plugin | Category | Job | Platforms |
| --- | --- | --- | --- |
| `sources/icloud-drive` | source | video files from iCloud Drive, on the Videos tab | iOS |
| `sync/icloud` | sync | a place for the account's encrypted backup file, saved after changes and opened on another device | iOS |

They are signed in to separately, and adding one never switches on the other.
Browsing iCloud Drive never touches where your account lives, and keeping
backups there never adds a source.

## Brings

Files — video files on iCloud Drive (`sources/icloud-drive`).

## Connection

No fields: both use the Apple account already on the device.

## Platforms

iOS only. iCloud Drive's container needs native code and an entitlement, so
both plugins ship an Expo module, need a development build and the Apple
Developer Program, and do not run on Android or the web.

## Status

Manifest only, and still Phase 4's single `icloud` plugin with two empty
roles. No role is implemented, so no capability is declared. The backup target
is planned for after the players (Phase 9's list).

See `docs/writing-a-plugin/` at the repository root.
