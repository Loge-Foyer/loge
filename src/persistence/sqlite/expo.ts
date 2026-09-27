import { openDatabaseAsync } from 'expo-sqlite';

import type { Logger } from '@/services/ports';

import { serializeSqlConnection, type SqlConnection, type SqlDatabase, type SqlValue } from './sql';

/**
 * The one place expo-sqlite is used: plain statements on one connection, which
 * `serializeSqlConnection` puts in order. Lint keeps its transaction helpers
 * out of everywhere else — see `sql.ts` for why neither is safe here.
 */
export async function openExpoSqlite(name: string, log: Logger): Promise<SqlDatabase> {
  const db = await openDatabaseAsync(name);
  // iOS keeps the native connection across a JS reload, which can leave it
  // inside a transaction; on that connection the foreign-keys pragma would do
  // nothing.
  if (await db.isInTransactionAsync()) await db.execAsync('ROLLBACK');
  const connection: SqlConnection = {
    run: async (sql, params = []) => ({ changes: (await db.runAsync(sql, [...params])).changes }),
    get: async <T>(sql: string, params: readonly SqlValue[] = []) => (await db.getFirstAsync<T>(sql, [...params])) ?? undefined,
    all: <T>(sql: string, params: readonly SqlValue[] = []) => db.getAllAsync<T>(sql, [...params]),
    exec: (sql) => db.execAsync(sql),
    close: () => db.closeAsync(),
  };
  return serializeSqlConnection(connection, { log, ...(__DEV__ ? { stallMs: 3_000 } : {}) });
}
