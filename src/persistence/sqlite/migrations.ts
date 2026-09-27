import { AppError } from '@sc/api';

import type { SqlDatabase, SqlExecutor } from './sql';

export interface SqlMigration {
  /** Sequential from 1, never reused, never edited once shipped. */
  readonly version: number;
  /** A step that rebuilds a table must run with foreign keys off, or dropping the old table cascades. */
  readonly foreignKeysOff?: true;
  up(tx: SqlExecutor): Promise<void>;
}

// Every table a profile owns cascades from `users`, so deleting a profile is
// one statement. The journal is the exception: it records the deletion too.
const V1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  pin_credential_ref TEXT,
  position INTEGER NOT NULL,
  version INTEGER NOT NULL
) STRICT;

CREATE TABLE device_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE connections (
  id TEXT PRIMARY KEY NOT NULL,
  plugin_id TEXT NOT NULL,
  label TEXT NOT NULL,
  roles TEXT NOT NULL,
  per_profile TEXT NOT NULL,
  fields TEXT NOT NULL,
  settings TEXT NOT NULL,
  credentials_ref TEXT,
  secret_keys TEXT,
  position INTEGER NOT NULL,
  version INTEGER NOT NULL
) STRICT;

CREATE TABLE connection_profile_values (
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  off INTEGER NOT NULL,
  fields TEXT NOT NULL,
  settings TEXT NOT NULL,
  credentials_ref TEXT,
  secret_keys TEXT,
  version INTEGER NOT NULL,
  PRIMARY KEY (connection_id, user_id)
) STRICT;
CREATE INDEX connection_profile_values_user ON connection_profile_values (user_id);

CREATE TABLE preferences (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
) STRICT;

CREATE TABLE change_journal (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  local_version INTEGER NOT NULL
) STRICT;

CREATE TABLE stale_secrets (
  ref TEXT PRIMARY KEY NOT NULL
) STRICT;

CREATE TABLE media_lists (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  list_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  items TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, connection_id, list_key)
) STRICT;
CREATE INDEX media_lists_connection ON media_lists (connection_id);
CREATE INDEX media_lists_saved_at ON media_lists (saved_at);

CREATE TABLE media_details (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  detail TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, connection_id, external_id)
) STRICT;
CREATE INDEX media_details_connection ON media_details (connection_id);
CREATE INDEX media_details_saved_at ON media_details (saved_at);
`;

export const MIGRATIONS: readonly SqlMigration[] = [{ version: 1, up: (tx) => tx.exec(V1) }];

/**
 * Brings the database up to date, one step per transaction, so a step that
 * fails leaves the version where it was. A database written by a newer app is
 * refused rather than guessed at, and nothing is ever wiped: viewing history
 * is not disposable.
 */
export async function migrate(db: SqlDatabase, migrations: readonly SqlMigration[] = MIGRATIONS): Promise<void> {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new Error(`Migration ${index + 1} is numbered ${migration.version}.`);
  });
  const current = (await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (current > migrations.length) {
    throw new AppError('STORAGE_FAILURE', 'The data on this device was saved by a newer version of Streaming Center. Update the app to open it.', {
      retry: 'never',
    });
  }
  for (const migration of migrations.slice(current)) {
    await db.transaction(
      async (tx) => {
        await migration.up(tx);
        await tx.exec(`PRAGMA user_version = ${migration.version}`);
      },
      migration.foreignKeysOff ? { foreignKeys: 'off' } : undefined,
    );
  }
}
