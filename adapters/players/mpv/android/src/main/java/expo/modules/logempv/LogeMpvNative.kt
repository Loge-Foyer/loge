package expo.modules.logempv

import android.content.Context
import android.view.Surface

/**
 * libmpv, through this package's own JNI (`src/main/cpp`).
 *
 * The engine's published Android wrapper is not used: it asks mpv for every
 * log message and prints each one to the device log, the address of the stream
 * it opens included — a Jellyfin api_key or a portal's session token with it.
 * No option turns that off, so this package talks to libmpv itself and asks
 * for no log at all.
 *
 * A handle is the address of the core's own record, and is what mpv's thread
 * names when it answers: the player it belongs to is looked up here.
 */
internal object LogeMpvNative {
  init {
    // The engine first — ours calls into it.
    System.loadLibrary("mpv")
    System.loadLibrary("loge-mpv")
  }

  // mpv_format, as its client API numbers them.
  const val FORMAT_NONE = 0
  const val FORMAT_FLAG = 3
  const val FORMAT_DOUBLE = 5

  // mpv_event_id, of those this package acts on.
  const val EVENT_START_FILE = 6
  const val EVENT_END_FILE = 7
  const val EVENT_FILE_LOADED = 8
  const val EVENT_PLAYBACK_RESTART = 21

  private val players = HashMap<Long, LogeMpvPlayer>()

  fun register(handle: Long, player: LogeMpvPlayer) {
    synchronized(players) { players[handle] = player }
  }

  fun forget(handle: Long) {
    synchronized(players) { players.remove(handle) }
  }

  private fun player(handle: Long): LogeMpvPlayer? = synchronized(players) { players[handle] }

  // Called from mpv's event thread.
  @JvmStatic
  fun onEvent(handle: Long, eventId: Int) {
    player(handle)?.onNativeEvent(eventId)
  }

  @JvmStatic
  fun onFlag(handle: Long, property: String, value: Boolean) {
    player(handle)?.onNativeFlag(property, value)
  }

  @JvmStatic
  fun onNumber(handle: Long, property: String, value: Double) {
    player(handle)?.onNativeNumber(property, value)
  }

  @JvmStatic
  fun onChange(handle: Long, property: String) {
    player(handle)?.onNativeChange(property)
  }

  /** Zero when the core could not be made. Options are set before `init`. */
  external fun create(context: Context): Long

  external fun init(handle: Long): Boolean

  external fun destroy(handle: Long)

  external fun command(handle: Long, parts: Array<String>)

  external fun setOptionString(handle: Long, name: String, value: String)

  external fun setPropertyString(handle: Long, name: String, value: String)

  external fun setPropertyInt(handle: Long, name: String, value: Int)

  external fun setPropertyDouble(handle: Long, name: String, value: Double)

  external fun setPropertyBoolean(handle: Long, name: String, value: Boolean)

  external fun getPropertyString(handle: Long, name: String): String?

  /** The fallback answers for a property this file has not got — one mpv has no answer for yet. */
  external fun getPropertyInt(handle: Long, name: String, fallback: Int): Int

  external fun getPropertyDouble(handle: Long, name: String, fallback: Double): Double

  external fun getPropertyBoolean(handle: Long, name: String, fallback: Boolean): Boolean

  external fun observeProperty(handle: Long, name: String, format: Int)

  /** What the disk cache holds, in bytes, data mpv has pruned included; -1 where there is none. */
  external fun cacheFileBytes(handle: Long): Double

  external fun attachSurface(handle: Long, surface: Surface)

  external fun detachSurface(handle: Long)
}
