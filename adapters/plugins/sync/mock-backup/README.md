# Mock backups

A pretend place for the account's encrypted backup file, kept in memory and
keyed by its endpoint, so saving to a backup target — and the conflict when two
devices save — can be tried with no cloud at all.

## Category

**Sync**, with a `backup` block — `sync/mock-backup`. Development builds only.

## How it behaves

- Writes are conditional: with an etag, a write refuses with `SYNC_CONFLICT`
  when the file changed since.
- It stores bytes and nothing else. The file's format and its encryption are
  the app's.
- A reload forgets every file.
