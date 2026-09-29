# iCloud Drive

Video files from iCloud Drive.

## Category

**Source** — `sources/icloud-drive`, in `plugins/sources/icloud-drive`. Its
files show on the Videos tab, and its connections belong to the account.

Keeping the account's backup in iCloud Drive is another plugin, `sync/icloud`.
Adding one never switches on the other: browsing iCloud Drive never touches
where your account lives, and keeping backups there never adds a source.

## Brings

Files — video files on iCloud Drive.

## Connection

No fields: it uses the Apple account already on the device.

## Platforms

iOS only. iCloud Drive's container needs native code and an entitlement, so
the plugin will ship an Expo module, and needs a development build and the
Apple Developer Program.

## Status

Manifest only. No media role yet, so no capability is declared.

See `docs/writing-a-plugin/` at the repository root.
