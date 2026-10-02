const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * One libc++_shared.so, and the newest.
 *
 * React Native, libVLC and libmpv each carry one, and an APK holds a single
 * copy: the first the merge sees, which is React Native's. libmpv needs
 * symbols that copy does not have, and loading it fails outright — while a
 * newer libc++ serves every older caller happily. A source set of the app's
 * own wins the merge outright, so mpv's module extracts the newest from its
 * engine and the app ships that.
 *
 * The app resolves it because packaging is the app's: a player plugin cannot
 * decide what a second plugin's engine put in the same APK. When React Native
 * ships a libc++ newer than every engine needs, this can go.
 *
 * mpv's module is found by the name autolinking gives its package, and a build
 * without it fails: skipped quietly, the APK would ship React Native's copy and
 * mpv would only fail on a device.
 */
const MARKER = '// Loge: one libc++_shared.so, and the newest';

const SNIPPET = `
${MARKER}
if (findProject(':loge-player-mpv') == null) {
  throw new GradleException("No :loge-player-mpv project, so libmpv would get React Native's libc++. config-plugins/with-newest-libcxx.js must follow the name of mpv's package.")
}
android.sourceSets.main.jniLibs.srcDir(new File(project(':loge-player-mpv').projectDir, 'build/libmpv-jni'))
tasks.named('preBuild') { dependsOn(':loge-player-mpv:unpackLibmpv') }
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
