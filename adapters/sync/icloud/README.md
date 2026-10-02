# iCloud

Keeps the account's encrypted backup file in iCloud Drive, in a "Loge" folder,
saved after changes and opened on another device.

## Category

**Sync**, with a `backup` block — `sync/icloud`. Device-wide: each device
chooses where its backups go. Browsing iCloud Drive's files is another plugin,
`sources/icloud-drive`.

## Platforms

iOS only: iCloud Drive's container needs native code and an entitlement.

## Status

Manifest only. The backup role is planned after the players (see Phase 9's
list). Writes will be conditional, so two devices never overwrite each other
in silence.
