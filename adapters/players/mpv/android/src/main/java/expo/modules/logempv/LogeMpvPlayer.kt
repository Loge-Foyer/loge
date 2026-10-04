package expo.modules.logempv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.Surface
import expo.modules.kotlin.AppContext
import java.io.File
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.sharedobjects.SharedObject
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

/**
 * One mpv core per controller.
 *
 * **Every call into mpv waits for its core**, which while a file opens is busy
 * for seconds at a time — reading a stream, starting MediaCodec, loading fonts
 * for the subtitles. So none of them is made on the app's main thread: they go
 * one after another on this player's own, and what mpv answers is turned into
 * an event on the main thread, where the listeners are. The surface is the
 * exception: Android hands it over and takes it back on the main thread, and
 * mpv has to be done with it before that call returns.
 */
class LogeMpvPlayer(context: Context, appContext: AppContext) : SharedObject(appContext) {
  // Zero when the native libraries will not load — an ABI this build has none
  // for. Loud here beats a player that draws nothing.
  private val mpv = LogeMpvNative.create(context).also {
    if (it == 0L) throw CodedException("mpv could not start on this device.")
  }
  private val main = Handler(Looper.getMainLooper())
  private val work = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "loge-mpv") }

  private var surface: Surface? = null
  // Set the moment a file is asked for, cleared once mpv has it: an end before
  // that is a file that never opened.
  private var loading = false
  private var loaded = false
  private var durationMs = 0L
  @Volatile private var lastSecond = -1L
  private var buffering = false
  @Volatile private var released = false
  // What mpv last said, so that nothing has to ask it again.
  private var paused = false
  private var ended = false
  // Playing when the surface went, and so to be taken up again when one comes back.
  private var pausedForSurface = false
  // Says so when a file opened but never played a frame.
  private var stalled: Runnable? = null
  // Where a disk cache is written, and how much it may hold; 0 while none is.
  private val cacheDir = File(context.cacheDir, "mpv")
  @Volatile private var diskLimit = 0L
  private var cacheWatch: Runnable? = null

  init {
    LogeMpvNative.register(mpv, this)
    // No mpv.conf, no scripts, no OSD, and no key handling: the app draws the
    // controls, and nothing on the device may change how this player behaves.
    option("config", "no")
    option("osc", "no")
    option("osd-level", "0")
    option("input-default-bindings", "no")
    option("input-vo-keyboard", "no")
    option("ytdl", "no")
    // Nothing beside the stream is opened: no sidecar subtitle or audio file.
    option("sub-auto", "no")
    option("audio-file-auto", "no")
    option("terminal", "no")
    // Idle, with no video output, until a view hands over a surface.
    option("idle", "yes")
    option("vo", "null")
    option("gpu-context", "android")
    option("opengl-es", "yes")
    option("ao", "audiotrack")
    // Downmixed: a phone has two speakers, and asking Android for a 5.1 track
    // is where mpv stops answering on a device that has none.
    option("audio-channels", "stereo")
    // Decoded in software, for now. Android's own decoder takes this
    // emulator's 1080p streams and then hands mpv no frame at all — in
    // `mediacodec-copy` and in `mediacodec` alike, while 720p plays — so
    // hardware decoding has never been seen to work here. FFmpeg's own
    // decoders play everything the profile claims, and the profile stops at
    // 1080p while they do the work. A real phone is what settles it.
    option("hwdec", "no")
    // At the end, stay on the last frame instead of shutting the core down, so
    // playing again is a seek rather than another open.
    option("keep-open", "always")
    if (!LogeMpvNative.init(mpv)) {
      LogeMpvNative.forget(mpv)
      LogeMpvNative.destroy(mpv)
      throw CodedException("mpv could not start on this device.")
    }
    observe("time-pos", LogeMpvNative.FORMAT_DOUBLE)
    observe("duration", LogeMpvNative.FORMAT_DOUBLE)
    observe("pause", LogeMpvNative.FORMAT_FLAG)
    observe("paused-for-cache", LogeMpvNative.FORMAT_FLAG)
    observe("eof-reached", LogeMpvNative.FORMAT_FLAG)
    observe("track-list", LogeMpvNative.FORMAT_NONE)
  }

  /** Options before `init` only: after it, every one of these waits for the core. */
  private fun option(name: String, value: String) = LogeMpvNative.setOptionString(mpv, name, value)

  private fun observe(name: String, format: Int) = LogeMpvNative.observeProperty(mpv, name, format)

  /** One after another, off the main thread; nothing more once the core is let go. */
  private fun onMpv(block: () -> Unit) {
    if (released) return
    try {
      work.execute { if (!released) block() }
    } catch (rejected: RejectedExecutionException) {
      // The player is on its way out.
    }
  }

  // ---- what JavaScript asks for ----

  fun load(uri: String, headers: Map<String, String>?, startMs: Double?, cache: Map<String, Any>?) {
    state("loading")
    // A new file is counted afresh, once it has loaded.
    main.post {
      stalled?.let { main.removeCallbacks(it) }
      cacheWatch?.let { main.removeCallbacks(it) }
    }
    // Everything this player knows about a file is kept on the one thread
    // that talks to mpv, and so is set there.
    onMpv {
      loading = true
      loaded = false
      buffering = false
      ended = false
      durationMs = 0
      lastSecond = -1
      applyHeaders(headers)
      applyCache(cache)
      // `start` applies to the next file, and is set on every load so the one
      // before cannot linger.
      LogeMpvNative.setPropertyString(mpv, "start", if (startMs != null && startMs > 0) "+${startMs / 1000.0}" else "none")
      LogeMpvNative.command(mpv, arrayOf("loadfile", uri))
    }
  }

  fun play() = onMpv { LogeMpvNative.setPropertyBoolean(mpv, "pause", false) }

  fun pause() = onMpv { LogeMpvNative.setPropertyBoolean(mpv, "pause", true) }

  /** After the end mpv holds the last frame, so playing again is a seek and an unpause. */
  fun replay(startMs: Double) = onMpv {
    LogeMpvNative.command(mpv, arrayOf("seek", (startMs / 1000.0).toString(), "absolute+exact"))
    LogeMpvNative.setPropertyBoolean(mpv, "pause", false)
  }

  fun seek(positionMs: Double) = onMpv {
    LogeMpvNative.command(mpv, arrayOf("seek", (positionMs / 1000.0).toString(), "absolute+exact"))
  }

  fun setRate(rate: Double) = onMpv { LogeMpvNative.setPropertyDouble(mpv, "speed", rate) }

  fun setSoftwareFallback(on: Boolean) = onMpv { LogeMpvNative.setPropertyString(mpv, "hwdec-software-fallback", if (on) "yes" else "no") }

  fun setVolume(volume: Int) = onMpv { LogeMpvNative.setPropertyDouble(mpv, "volume", volume.toDouble()) }

  fun setAudioTrack(id: Int) = onMpv {
    if (id < 0) LogeMpvNative.setPropertyString(mpv, "aid", "no") else LogeMpvNative.setPropertyInt(mpv, "aid", id)
  }

  fun setSubtitleTrack(id: Int) = onMpv {
    if (id < 0) LogeMpvNative.setPropertyString(mpv, "sid", "no") else LogeMpvNative.setPropertyInt(mpv, "sid", id)
  }

  // ---- the view's surface, on the main thread ----

  fun attachSurface(next: Surface, width: Int, height: Int) {
    if (released) return
    // Android hands out the same Surface object after one is destroyed, so
    // what is attached is tracked here rather than compared.
    if (surface != null) detachSurface()
    surface = next
    LogeMpvNative.attachSurface(mpv, next)
    LogeMpvNative.setPropertyString(mpv, "vo", "gpu")
    surfaceSize(width, height)
    if (pausedForSurface) {
      pausedForSurface = false
      LogeMpvNative.setPropertyBoolean(mpv, "pause", false)
    }
  }

  fun surfaceSize(width: Int, height: Int) {
    if (released || surface == null || width <= 0 || height <= 0) return
    LogeMpvNative.setPropertyString(mpv, "android-surface-size", "${width}x$height")
  }

  fun detachSurface() {
    if (released || surface == null) return
    surface = null
    // mpv stops answering if its video output goes while it is playing, so it
    // is paused first and taken up again when a surface comes back — which is
    // what turning the device does.
    pausedForSurface = !paused
    if (pausedForSurface) LogeMpvNative.setPropertyBoolean(mpv, "pause", true)
    // The picture stops before the surface goes, or mpv draws into a dead one.
    LogeMpvNative.setPropertyString(mpv, "vo", "null")
    LogeMpvNative.detachSurface(mpv)
  }

  /** `cover` fills the screen and crops; `contain` fits the whole picture in. */
  fun setFit(fit: String) = onMpv {
    LogeMpvNative.setPropertyDouble(mpv, "panscan", if (fit == "cover") 1.0 else 0.0)
  }

  // ---- what mpv says, from its own thread ----

  internal fun onNativeEvent(eventId: Int) = onMpv { onEvent(eventId) }

  internal fun onNativeChange(property: String) = onMpv { if (property == "track-list") tracks() }

  internal fun onNativeNumber(property: String, value: Double) = onMpv { onNumber(property, value) }

  internal fun onNativeFlag(property: String, value: Boolean) = onMpv { onFlag(property, value) }

  private fun onEvent(eventId: Int) {
    when (eventId) {
      LogeMpvNative.EVENT_START_FILE -> state("loading")
      LogeMpvNative.EVENT_FILE_LOADED -> {
        loading = false
        loaded = true
        tracks()
        main.post { watch() }
      }
      // The first frame is up, here or after a seek: what mpv is doing now is
      // whatever `pause` says.
      LogeMpvNative.EVENT_PLAYBACK_RESTART -> if (loaded) fromPause()
      LogeMpvNative.EVENT_END_FILE ->
        if (loading) {
          loading = false
          // Why the file ended does not reach here, so a file that never
          // loaded is how a failure is known. The message never quotes the
          // address.
          emitOnMain("error", mapOf("message" to "mpv could not play this stream."))
        }
    }
  }

  private fun onNumber(property: String, value: Double) {
    when (property) {
      "duration" -> durationMs = (value * 1000).toLong()
      // Once a second is enough for a scrubber and for progress reports.
      "time-pos" -> {
        val ms = (value * 1000).toLong()
        val second = ms / 1000
        if (second != lastSecond) {
          if (lastSecond < 0) main.post { stalled?.let { main.removeCallbacks(it) } }
          lastSecond = second
          position(ms)
        }
      }
    }
  }

  private fun onFlag(property: String, value: Boolean) {
    when (property) {
      "eof-reached" -> {
        ended = value
        if (!loaded) return
        if (value) state("ended") else fromPause()
      }
      "paused-for-cache" -> {
        buffering = value
        if (!loaded) return
        if (value) state("buffering") else fromPause()
      }
      "pause" -> {
        paused = value
        if (loaded && !buffering) fromPause()
      }
    }
  }

  private fun fromPause() {
    if (ended) return
    state(if (paused) "paused" else "playing")
  }

  private fun state(value: String) {
    emitOnMain("state", mapOf("state" to value))
  }

  private fun position(ms: Long) {
    // A live stream has no length, and mpv leaves it at zero.
    val payload = mutableMapOf<String, Any>("positionMs" to ms.coerceAtLeast(0).toDouble())
    if (durationMs > 0) payload["durationMs"] = durationMs.toDouble()
    emitOnMain("position", payload)
  }

  /** mpv names every track's language and codec, so the app's labels are the file's own. */
  private fun tracks() {
    val count = LogeMpvNative.getPropertyInt(mpv, "track-list/count", 0)
    val audio = mutableListOf<Map<String, Any>>()
    val subtitles = mutableListOf<Map<String, Any>>()
    for (index in 0 until count) {
      val type = LogeMpvNative.getPropertyString(mpv, "track-list/$index/type") ?: continue
      if (type != "audio" && type != "sub") continue
      val id = LogeMpvNative.getPropertyInt(mpv, "track-list/$index/id", -1)
      if (id < 0) continue
      val track = mutableMapOf<String, Any>("id" to id)
      LogeMpvNative.getPropertyString(mpv, "track-list/$index/title")?.let { track["title"] = it }
      LogeMpvNative.getPropertyString(mpv, "track-list/$index/lang")?.let { track["language"] = it }
      LogeMpvNative.getPropertyString(mpv, "track-list/$index/codec")?.let { track["codec"] = it }
      if (type == "audio") audio.add(track) else subtitles.add(track)
    }
    emitOnMain("tracks", mapOf("audio" to audio, "subtitles" to subtitles))
  }

  /**
   * A decoder that takes a stream and then hands back no frame leaves mpv
   * loading for ever — and the screen with a spinner and nothing to read. Ten
   * seconds from the file loading without a position is that, said out loud.
   * The first position calls it off. Opening is not counted: YouTube's HLS
   * names every rendition and every dubbed language, and mpv reads each
   * playlist before it starts (`ios/LogeMpvPlayer.swift`). A file that never
   * loads ends, and says so then.
   */
  private fun watch() {
    stalled?.let { main.removeCallbacks(it) }
    val alarm = Runnable {
      if (released || lastSecond >= 0) return@Runnable
      emit("error", mapOf("message" to "mpv could not play this stream on this device."))
    }
    stalled = alarm
    main.postDelayed(alarm, 10_000)
  }

  /**
   * How far ahead mpv reads for this file, and where it keeps it — the
   * device's Buffering, decided per file in TypeScript (`src/engine.ts`).
   * `off` reads no further than playing needs; `memory` is mpv's own cache;
   * `disk` writes it to a file in the app's caches, where it may outgrow
   * memory. That file only grows — mpv frees nothing in it until the file is
   * closed — so at its limit it is closed to new data, and mpv carries on in
   * memory. With too little room for the limit, memory from the start.
   */
  private fun applyCache(cache: Map<String, Any>?) {
    val mode = cache?.get("mode") as? String
    val limit = (cache?.get("limitBytes") as? Number)?.toLong() ?: 0L
    diskLimit = 0
    val disk = mode == "disk" && limit > 0 && (cacheDir.isDirectory || cacheDir.mkdirs()) && cacheDir.usableSpace > limit + KEEP_FREE_BYTES
    LogeMpvNative.setPropertyString(mpv, "cache", if (mode == "off") "no" else if (disk) "yes" else "auto")
    LogeMpvNative.setPropertyString(mpv, "cache-on-disk", if (disk) "yes" else "no")
    if (!disk) return
    LogeMpvNative.setPropertyString(mpv, "demuxer-cache-dir", cacheDir.path)
    diskLimit = limit
    main.post { watchCache() }
  }

  /** Once a second while a disk cache fills: at its limit, no more is written to it. */
  private fun watchCache() {
    cacheWatch?.let { main.removeCallbacks(it) }
    val check = object : Runnable {
      override fun run() {
        if (released || diskLimit <= 0) return
        onMpv {
          val limit = diskLimit
          if (limit > 0 && LogeMpvNative.cacheFileBytes(mpv) >= limit) {
            diskLimit = 0
            LogeMpvNative.setPropertyString(mpv, "cache-on-disk", "no")
          }
        }
        main.postDelayed(this, 1_000)
      }
    }
    cacheWatch = check
    main.postDelayed(check, 1_000)
  }

  private fun emitOnMain(name: String, payload: Map<String, Any>) {
    main.post { if (!released) emit(name, payload) }
  }

  /**
   * mpv sends any header a stream needs. Its list options take each item as
   * `%<bytes>%<item>`, which is what keeps a header holding a comma — a cookie,
   * most of all — from being read as two.
   */
  private fun applyHeaders(headers: Map<String, String>?) {
    var userAgent: String? = null
    var referrer: String? = null
    val fields = mutableListOf<String>()
    for ((name, value) in headers ?: emptyMap()) {
      when (name.lowercase()) {
        "user-agent" -> userAgent = value
        "referer", "referrer" -> referrer = value
        else -> {
          val field = "$name: $value"
          fields.add("%${field.toByteArray(Charsets.UTF_8).size}%$field")
        }
      }
    }
    LogeMpvNative.setPropertyString(mpv, "user-agent", userAgent ?: "")
    LogeMpvNative.setPropertyString(mpv, "referrer", referrer ?: "")
    LogeMpvNative.setPropertyString(mpv, "http-header-fields", fields.joinToString(","))
  }

  /**
   * Straight to the end: taking the video output away first is what wedges
   * mpv, and letting the core go takes the picture, the sound and the stream
   * with it anyway.
   */
  fun releasePlayer() {
    if (released) return
    released = true
    surface = null
    stalled?.let { main.removeCallbacks(it) }
    cacheWatch?.let { main.removeCallbacks(it) }
    LogeMpvNative.forget(mpv)
    // Behind whatever was already asked of mpv, so nothing is in the core when it goes.
    work.execute { LogeMpvNative.destroy(mpv) }
    work.shutdown()
  }

  // Not on the app's main queue: a reload cancels it, and the core would leak.
  @OptIn(DelicateCoroutinesApi::class)
  override fun sharedObjectDidRelease() {
    super.sharedObjectDidRelease()
    GlobalScope.launch(Dispatchers.Main) { releasePlayer() }
  }

  private companion object {
    // Room the device keeps for itself beside a disk cache: past this, memory instead.
    const val KEEP_FREE_BYTES = 1L shl 30
  }
}
