import { AppError } from '@sc/api';

import { qualifiedIdOf, qualifiedPluginStates, sessionRefOf } from '../plugin-ids';

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

// The account phase. Entries written before it get no change id: every
// account starts with a join above them, so they are never sent.
const V2 = `
ALTER TABLE change_journal ADD COLUMN change_id TEXT;

CREATE TABLE sync_state (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  cursor TEXT,
  checkpoint INTEGER NOT NULL,
  awaiting TEXT NOT NULL,
  carried TEXT NOT NULL,
  last_synced_at INTEGER
) STRICT;
`;

export const MIGRATIONS: readonly SqlMigration[] = [
  { version: 1, up: (tx) => tx.exec(V1) },
  {
    version: 2,
    up: async (tx) => {
      await tx.exec(V2);
      // "Sync on" means "the account" from now on, and none is chosen yet. Before,
      // adding a sync-only plugin switched its sync role on by itself.
      for (const row of await tx.all<{ id: string; roles: string }>('SELECT id, roles FROM connections')) {
        const roles = JSON.parse(row.roles) as Record<string, boolean>;
        if (roles.sync === true) {
          await tx.run('UPDATE connections SET roles = ? WHERE id = ?', [JSON.stringify({ ...roles, sync: false }), row.id]);
        }
      }
    },
  },
  {
    version: 3,
    up: async (tx) => {
      // Plugins moved into category folders, and an id names its category now.
      for (const row of await tx.all<{ id: string; plugin_id: string; roles: string }>('SELECT id, plugin_id, roles FROM connections')) {
        const qualified = qualifiedIdOf(row.plugin_id, JSON.parse(row.roles) as Record<string, unknown>);
        if (qualified !== row.plugin_id) await tx.run('UPDATE connections SET plugin_id = ? WHERE id = ?', [qualified, row.id]);
      }
      const plugins = await tx.get<{ value: string }>("SELECT value FROM device_settings WHERE key = 'plugins'");
      if (plugins) {
        const states = qualifiedPluginStates(JSON.parse(plugins.value) as Record<string, unknown>);
        await tx.run("UPDATE device_settings SET value = ? WHERE key = 'plugins'", [JSON.stringify(states)]);
      }
    },
  },
  { version: 4, up: accountModel },
  { version: 5, up: (tx) => tx.exec(V5) },
  { version: 6, up: (tx) => tx.exec(V6) },
  { version: 7, up: (tx) => tx.exec(V7) },
  { version: 8, up: (tx) => tx.exec(V8) },
];

// Favourite channels (after Phase 10): the ★ a profile keeps before a
// provider's groups. Account-wide like the subscriptions of v7 — journaled,
// carried to your own server, written into backups — and cascading from the
// connection as well as the profile: a channel goes with its source.
const V8 = `
CREATE TABLE favorite_channels (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  number INTEGER,
  logo TEXT,
  added_at TEXT NOT NULL,
  version INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX favorite_channels_channel ON favorite_channels (user_id, connection_id, external_id);
CREATE INDEX favorite_channels_connection ON favorite_channels (connection_id);
`;

// Watch status, for sources that master it (Phase 7): a cache per profile,
// and the outbox that carries this device's changes to the source. Both are
// the device's: never journaled, never in a backup.
// Files kept on this device (Phase 10). Device state, like the watch cache and
// unlike anything the account holds: never journaled, never pushed, never in a
// backup — a copy on this phone is this phone's. It cascades from both parents
// so removing a profile or a connection takes its downloads' rows; the files
// themselves are swept separately, since a cascade cannot delete from disk.
// Lists a profile owns (Phase 10): channels it follows, and lists it made.
// Unlike `downloads` beside them, these are account-wide — journaled, carried
// to your own server, written into backups — because they are the profile's
// own and belong wherever it signs in. A subscription cascades from its
// connection too: unfollowing is implied by the source going away.
const V7 = `
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  added_at TEXT NOT NULL,
  version INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX subscriptions_channel ON subscriptions (user_id, connection_id, external_id);
CREATE INDEX subscriptions_connection ON subscriptions (connection_id);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  items TEXT NOT NULL,
  source_connection_id TEXT,
  source_external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
) STRICT;
CREATE INDEX playlists_user ON playlists (user_id);
`;

const V6 = `
CREATE TABLE downloads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  state TEXT NOT NULL,
  option_id TEXT,
  item TEXT NOT NULL,
  file_name TEXT NOT NULL,
  container TEXT NOT NULL,
  bytes_total INTEGER,
  bytes_done INTEGER NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX downloads_item ON downloads (user_id, connection_id, external_id);
CREATE INDEX downloads_connection ON downloads (connection_id);
CREATE INDEX downloads_state ON downloads (state);
`;

const V5 = `
CREATE TABLE watch_status (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL,
  item TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, connection_id, external_id)
) STRICT;
CREATE INDEX watch_status_connection ON watch_status (connection_id);
CREATE INDEX watch_status_updated_at ON watch_status (updated_at);

CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  report TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  not_before INTEGER
) STRICT;
CREATE INDEX outbox_item ON outbox (user_id, connection_id, external_id);
CREATE INDEX outbox_connection ON outbox (connection_id);
`;

// One account per device, local or on your own server (Phase 6). Phase 4's
// account — every sync-category connection — goes with every secret it held:
// the device keeps its profiles as a local account (ensureAccount, at boot),
// and a server account starts again with a full upload or download.
const V4 = `
DROP TABLE sync_state;

CREATE TABLE account (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  connection_id TEXT,
  max_profiles INTEGER
) STRICT;

CREATE TABLE account_sync (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  checkpoint INTEGER NOT NULL,
  last_synced_at INTEGER,
  held_back TEXT NOT NULL
) STRICT;

CREATE TABLE backup_state (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  lineage TEXT NOT NULL,
  generation INTEGER NOT NULL,
  etag TEXT,
  saved_at INTEGER
) STRICT;
`;

async function accountModel(tx: SqlExecutor): Promise<void> {
  const users = (await tx.all<{ id: string }>('SELECT id FROM users')).map((user) => user.id);
  for (const connection of await tx.all<{ id: string; credentials_ref: string | null }>(
    "SELECT id, credentials_ref FROM connections WHERE plugin_id LIKE 'sync/%'",
  )) {
    const own = await tx.all<{ credentials_ref: string | null }>('SELECT credentials_ref FROM connection_profile_values WHERE connection_id = ?', [
      connection.id,
    ]);
    const refs = [
      connection.credentials_ref,
      ...own.map((row) => row.credentials_ref),
      ...['shared', 'account', ...users].map((scope) => sessionRefOf(connection.id, scope)),
    ];
    for (const ref of refs) {
      if (ref !== null) await tx.run('INSERT INTO stale_secrets (ref) VALUES (?) ON CONFLICT (ref) DO NOTHING', [ref]);
    }
    // The cascade takes its profile values, its saved media and its sync state.
    await tx.run('DELETE FROM connections WHERE id = ?', [connection.id]);
  }

  // A role switch becomes one switch: on or off, on every device of the account.
  await tx.exec('ALTER TABLE connections ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
  for (const row of await tx.all<{ id: string; roles: string }>('SELECT id, roles FROM connections')) {
    const roles = JSON.parse(row.roles) as Record<string, unknown>;
    if (roles.media === false) await tx.run('UPDATE connections SET enabled = 0 WHERE id = ?', [row.id]);
  }
  await tx.exec('ALTER TABLE connections DROP COLUMN roles');
  await tx.exec(V4);
  await tx.run("DELETE FROM device_settings WHERE key IN ('plugins', 'leftAccountAt')");
  // Its entries were for the old log; sequence numbers carry on, never reused.
  await tx.run('DELETE FROM change_journal');
}

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
