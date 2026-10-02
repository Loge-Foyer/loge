package expo.modules.logepip

import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.core.util.Consumer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Picture in picture on Android, which is the *activity* shrinking rather than
 * any one engine handing a layer over. That is why it lives here and not in a
 * player: every engine gets it, whatever it draws with, and a player stays the
 * engine rather than the experience.
 *
 * iPhone is the other way round — there the system takes over a layer, so only
 * an engine that draws into one can offer it, and each does so for itself.
 */
class LogePipModule : Module() {
  private var listening: Consumer<androidx.core.app.PictureInPictureModeChangedInfo>? = null

  override fun definition() = ModuleDefinition {
    Name("LogePip")

    Events("onModeChange")

    OnCreate {
      val activity = appContext.activityProvider?.currentActivity as? ComponentActivity ?: return@OnCreate
      val consumer = Consumer<androidx.core.app.PictureInPictureModeChangedInfo> { info ->
        sendEvent("onModeChange", mapOf("inPictureInPicture" to info.isInPictureInPictureMode))
      }
      listening = consumer
      activity.addOnPictureInPictureModeChangedListener(consumer)
    }

    OnDestroy {
      val activity = appContext.activityProvider?.currentActivity as? ComponentActivity
      listening?.let { activity?.removeOnPictureInPictureModeChangedListener(it) }
      listening = null
    }

    /** Whether this device has it at all: a television or a car often does not. */
    Function("isAvailable") {
      val activity = appContext.activityProvider?.currentActivity ?: return@Function false
      activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }

    /**
     * From Android 12 the system does it by itself when the app is swiped
     * away, which is what anyone means by picture in picture. Before that
     * there is nothing to arrange ahead of time, and `enter` is the only way.
     */
    Function("setAutoEnter") { on: Boolean ->
      val activity = appContext.activityProvider?.currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function false
      activity.setPictureInPictureParams(params(on))
      true
    }

    /** Now, rather than when the app is left — for a button that asks for it. */
    Function("enter") {
      val activity = appContext.activityProvider?.currentActivity ?: return@Function false
      if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return@Function false
      activity.enterPictureInPictureMode(params(true))
    }

    Function("isActive") {
      val activity = appContext.activityProvider?.currentActivity ?: return@Function false
      activity.isInPictureInPictureMode
    }
  }

  /** 16:9, which is what nearly everything is and what the system rounds to anyway. */
  private fun params(autoEnter: Boolean): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setAutoEnterEnabled(autoEnter)
    return builder.build()
  }
}
