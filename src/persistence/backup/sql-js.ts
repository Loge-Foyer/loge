import type { BindParams, Database, SqlJsStatic } from 'sql.js';

import type { BackupSql, BackupSqlDatabase } from '@/services/ports';

/**
 * A backup's database on sql.js — the web's, and what the tests run on Node.
 * `load` brings sql.js in only when a backup is written or opened, so no page
 * that never does pays for it.
 */
export function createSqlJsBackup(load: () => Promise<SqlJsStatic>): BackupSql {
  let ready: Promise<SqlJsStatic> | undefined;
  const sqlJs = () => {
    ready ??= load().catch((error: unknown) => {
      // Tried again next time: a failed download is no reason to give up for good.
      ready = undefined;
      throw error;
    });
    return ready;
  };
  return {
    create: async () => wrap(new (await sqlJs()).Database()),
    open: async (bytes) => wrap(new (await sqlJs()).Database(bytes)),
  };
}

function wrap(db: Database): BackupSqlDatabase {
  const params = (values: readonly (string | number | null)[] | undefined): BindParams => [...(values ?? [])];
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, values) => {
      db.run(sql, params(values));
    },
    all: async <T>(sql: string, values?: readonly (string | number | null)[]) => {
      const statement = db.prepare(sql, params(values));
      try {
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
      } finally {
        statement.free();
      }
    },
    serialize: async () => db.export(),
    close: async () => {
      db.close();
    },
  };
}
