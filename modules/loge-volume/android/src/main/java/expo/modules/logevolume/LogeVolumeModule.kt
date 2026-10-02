package expo.modules.logevolume

import android.content.Context
import android.database.ContentObserver
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

/**
 * The device's media volume, which the player's edge slider moves: one
 * volume, the one the side buttons change, not a second one inside an engine.
 * Android keeps it as steps of the music stream; this turns them into 0 to 1
 * and back.
 */
class LogeVolumeModule : Module() {
  private var observer: ContentObserver? = null

  private val audio: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("LogeVolume")

    Events("onChange")

    Function("get") {
      audio?.let { level(it) }
    }

    AsyncFunction("set") { value: Double ->
      val manager = audio ?: return@AsyncFunction
      val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      try {
        // No flags: the player draws its own slider, so the system's panel stays away.
        manager.setStreamVolume(AudioManager.STREAM_MUSIC, (value.coerceIn(0.0, 1.0) * max).roundToInt(), 0)
      } catch (_: SecurityException) {
        // Do Not Disturb refuses a change that would lift it; the slider stays where it was.
      }
    }

    // Nothing to arrange: Android draws no banner for a change the app makes.
    AsyncFunction("attach") {}
    AsyncFunction("release") {}

    // The side buttons, a headset, the system's own panel: whatever moved it.
    // The system writes each change to its settings, so watching them hears
    // every one, with no broadcast to register for.
    OnStartObserving {
      val context = appContext.reactContext ?: return@OnStartObserving
      val manager = audio ?: return@OnStartObserving
      var last = manager.getStreamVolume(AudioManager.STREAM_MUSIC)
      val watcher = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) {
          val now = manager.getStreamVolume(AudioManager.STREAM_MUSIC)
          if (now == last) return
          last = now
          sendEvent("onChange", mapOf("volume" to level(manager)))
        }
      }
      context.contentResolver.registerContentObserver(Settings.System.CONTENT_URI, true, watcher)
      observer = watcher
    }

    OnStopObserving {
      observer?.let { appContext.reactContext?.contentResolver?.unregisterContentObserver(it) }
      observer = null
    }
  }

  private fun level(manager: AudioManager): Double {
    val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    return if (max <= 0) 0.0 else manager.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max
  }
}
