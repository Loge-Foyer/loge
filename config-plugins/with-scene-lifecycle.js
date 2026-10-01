const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

/**
 * The scene-based life cycle, which iOS and tvOS 27 require of an app built
 * with their SDK: one whose app delegate still makes its own window is
 * stopped at launch (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`,
 * a trap, before a line of JavaScript runs). tvOS 27 was the first to show it.
 *
 * Expo 57 ships the scene delegate (`ExpoAppSceneDelegate`, registered as
 * `EXExpoAppSceneDelegate`) but its template does not use it yet, so this
 * does: the Info.plist names it as the only scene's delegate, and the app
 * delegate keeps the React Native factory it makes at launch and leaves the
 * window — and starting React Native in it — to the scene. When the template
 * adopts scenes by itself, this goes.
 */
const SCENE_DELEGATE = 'EXExpoAppSceneDelegate';

const DECLARATION = 'class AppDelegate: ExpoAppDelegate {';
// What the template does that the scene delegate does instead.
const WINDOW = /\n#if os\(iOS\) \|\| os\(tvOS\)\n {4}window = UIWindow\(frame: UIScreen\.main\.bounds\)\n {4}factory\.startReactNative\(\n {6}withModuleName: "main",\n {6}in: window,\n {6}launchOptions: launchOptions\)\n#endif\n/;

function withSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: SCENE_DELEGATE }],
      },
    };
    return config;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    const { contents, language } = config.modResults;
    if (language !== 'swift') throw new Error('with-scene-lifecycle expects the Swift AppDelegate Expo generates.');
    if (contents.includes('ExpoReactNativeFactoryProvider')) return config;
    // Loud rather than half-done: a template that changed may already adopt scenes, or need this rewritten.
    if (!contents.includes(DECLARATION) || !WINDOW.test(contents)) {
      throw new Error('with-scene-lifecycle: the AppDelegate template has changed — check whether it adopts the scene life cycle itself now.');
    }
    config.modResults.contents = contents
      .replace(DECLARATION, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
      .replace(WINDOW, '\n    // The window, and React Native in it, are the scene delegate’s: `ExpoAppSceneDelegate`.\n');
    return config;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneManifest(config));
};
