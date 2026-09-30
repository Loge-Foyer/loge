import * as SQLite from 'expo-sqlite';

import type { BackupSql, BackupSqlDatabase } from '@/services/ports';

/**
 * A backup's database on a phone: expo-sqlite, in memory, serialized to bytes
 * and back. Never the device database, and never a file on disk: the backup
 * holds every password, so it exists unencrypted only in memory. The web
 * build uses `sql.web.ts`.
 */
export const backupSql: BackupSql = {
  create: async () => wrap(await SQLite.openDatabaseAsync(':memory:')),
  open: async (bytes) => wrap(await SQLite.deserializeDatabaseAsync(bytes)),
};

function wrap(db: SQLite.SQLiteDatabase): BackupSqlDatabase {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => {
      await db.runAsync(sql, [...(params ?? [])]);
    },
    all: (sql, params) => db.getAllAsync(sql, [...(params ?? [])]),
    serialize: () => db.serializeAsync(),
    close: () => db.closeAsync(),
  };
}
