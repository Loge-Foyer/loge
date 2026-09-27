import { afterAll } from 'vitest';

import { removeTempDatabases } from './engines';

// The SQLite files tests open twice — to restart on them — go when the file's tests are done.
afterAll(removeTempDatabases);
