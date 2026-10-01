// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The adapters are workspaces of this app, under `adapters/`, so Metro already
// serves them: they are inside the project root, and their imports resolve
// from the one `node_modules` everything shares. There is nothing to watch
// elsewhere, nothing to rewrite, and no second copy of React to block — all of
// which this file used to arrange when they were a repository of their own.

// sql.js's WebAssembly, for backups on the web: served as a file, fetched by
// the lazily loaded chunk that needs it (src/persistence/backup/sql-js-web.ts).
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

module.exports = config;
