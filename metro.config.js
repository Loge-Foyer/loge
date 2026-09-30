// Learn more: https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @sc/api and every plugin live in a sibling repository, linked in with
// `file:` dependencies. Metro only serves files under the project root or a
// watch folder.
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, '../streaming_center_plugins'),
];

// sql.js's WebAssembly, for backups on the web: served as a file, fetched by
// the lazily loaded chunk that needs it (src/persistence/backup/sql-js-web.ts).
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

module.exports = config;
