const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * One libc++_shared.so, and the newest.
 *
 * React Native and libmpv each carry one, and an APK holds a single
 * copy: the first the merge sees, which is React Native's. libmpv needs
 * symbols that copy does not have, and loading it fails outright — while a
 * newer libc++ serves every older caller happily. A source set of the app's
 * own wins the merge outright, so mpv's module extracts the newest from its
 * engine and the app ships that.
 *
 * The app resolves it because packaging is the app's: a player plugin cannot
 * decide what a second plugin's engine put in the same APK. When React Native
 * ships a libc++ newer than every engine needs, this can go.
 */
const MARKER = '// Streaming Center: one libc++_shared.so, and the newest';

const SNIPPET = `
${MARKER}
if (findProject(':sc-player-mpv') != null) {
  android.sourceSets.main.jniLibs.srcDir(new File(project(':sc-player-mpv').projectDir, 'build/libmpv-jni'))
  tasks.named('preBuild') { dependsOn(':sc-player-mpv:unpackLibmpv') }
}
`;

module.exports = function withNewestLibcxx(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('with-newest-libcxx expects the Groovy build file Expo generates.');
    }
    if (!config.modResults.contents.includes(MARKER)) {
      config.modResults.contents += SNIPPET;
    }
    return config;
  });
};
