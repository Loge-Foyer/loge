import { Asset } from 'expo-asset';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasm from 'sql.js/dist/sql-wasm-browser.wasm';

/** Only `sql.web.ts` imports this, through `import()`: sql.js and its WebAssembly ride in one lazy chunk. */
export async function loadSqlJs(): Promise<SqlJsStatic> {
  const asset = Asset.fromModule(wasm);
  return initSqlJs({ locateFile: () => asset.uri });
}
