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

module.exports = config;
