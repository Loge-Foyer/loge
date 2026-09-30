import type { BackupSql } from '@/services/ports';

import { createSqlJsBackup } from './sql-js';

/**
 * A backup's database in a browser: sql.js, brought in through `import()` when
 * a backup is written or opened — a chunk of its own, never in the entry
 * bundle. The web's own data stays in IndexedDB; this is only ever a backup.
 */
export const backupSql: BackupSql = createSqlJsBackup(async () => (await import('./sql-js-web')).loadSqlJs());
