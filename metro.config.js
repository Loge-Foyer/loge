// Learn more: https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const plugins = path.resolve(__dirname, '../streaming_center_plugins');

// @sc/api and every plugin live in a sibling repository, linked in with
// `file:` dependencies. Metro only serves files under the project root or a
// watch folder.
config.watchFolders = [...config.watchFolders, plugins];

// A plugin file's imports resolve from the app, as a published package's
// would. The plugins repository installs React, React Native and expo-video
// for its own typecheck and tests; resolved from there, a second React breaks
// every hook and a second expo-video its native views. Its node_modules are
// blocked outright, so a request that slips past this fails the build instead
// of bundling a second copy.
const appOrigin = path.join(__dirname, 'package.json');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const bare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName);
  if (bare && context.originModulePath.startsWith(plugins + path.sep)) {
    return context.resolveRequest({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  ...[config.resolver.blockList ?? []].flat(),
  new RegExp(`^${escape(path.join(plugins, 'node_modules'))}[\\\\/].*`),
];

// sql.js's WebAssembly, for backups on the web: served as a file, fetched by
// the lazily loaded chunk that needs it (src/persistence/backup/sql-js-web.ts).
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

module.exports = config;
