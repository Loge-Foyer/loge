/**
 * The version is package.json's alone: with none in app.json, Expo takes it
 * from there, and this derives from it the build number both stores want.
 * Loge and Foyer share one version — YEAR.MONTH.BUILD, where BUILD counts
 * every release and never goes down — and `npm run release` moves both.
 */
module.exports = ({ config }) => {
  const build = /^\d{4}\.(?:[1-9]|1[0-2])\.([1-9]\d*)$/.exec(config.version ?? '')?.[1];
  if (!build) {
    throw new Error(`package.json's version must be YEAR.MONTH.BUILD, such as 2026.10.1, not ${config.version}.`);
  }
  return {
    ...config,
    ios: { ...config.ios, buildNumber: build },
    android: { ...config.android, versionCode: Number(build) },
  };
};
