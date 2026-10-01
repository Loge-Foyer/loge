const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Picture in picture on Android is the activity shrinking, and an activity has
 * to say it can before the system will do it. It also has to accept being
 * resized, or the window is refused.
 *
 * This is the app's to declare, not a player's: every engine shrinks with the
 * activity, whatever it draws with. On iPhone it works the other way round —
 * the system takes over a layer — so each engine offers it for itself there.
 */
module.exports = function withPictureInPicture(config) {
  return withAndroidManifest(config, (modified) => {
    const application = modified.modResults.manifest.application?.[0];
    const activity = application?.activity?.find((each) => each.$['android:name'] === '.MainActivity');
    if (!activity) return modified;
    activity.$['android:supportsPictureInPicture'] = 'true';
    activity.$['android:resizeableActivity'] = 'true';
    // Without this the activity is recreated on the way in, and playback restarts.
    const changes = activity.$['android:configChanges'];
    if (changes && !changes.includes('screenLayout')) {
      activity.$['android:configChanges'] = `${changes}|screenLayout|smallestScreenSize`;
    }
    return modified;
  });
};
