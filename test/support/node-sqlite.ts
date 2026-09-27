import { DatabaseSync } from 'node:sqlite';

import type { SqlConnection, SqlValue } from '@/persistence/sqlite/sql';

/**
 * The real SQLite, through Node, for the app's SQLite code to run on in tests.
 * Foreign keys start off, as they do in expo-sqlite, so only the app's own
 * pragma turns them on — a forgotten pragma fails here too.
 */
export function nodeSqliteConnection(path = ':memory:'): SqlConnection {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  return {
    run: async (sql, params: readonly SqlValue[] = []) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
    get: async <T>(sql: string, params: readonly SqlValue[] = []) => db.prepare(sql).get(...params) as unknown as T | undefined,
    all: async <T>(sql: string, params: readonly SqlValue[] = []) => db.prepare(sql).all(...params) as unknown as T[],
    exec: async (sql) => {
      db.exec(sql);
    },
    close: async () => {
      db.close();
    },
  };
}
