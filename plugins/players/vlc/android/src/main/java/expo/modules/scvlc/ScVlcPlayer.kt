package expo.modules.scvlc

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.sharedobjects.SharedObject
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer

/**
 * One libVLC player per controller. Every call reaches it on the main thread,
 * where libVLC sends its events too.
 */
class ScVlcPlayer(context: Context, appContext: AppContext) : SharedObject(appContext) {
  // Quiet: libVLC's messages quote the stream's address, token and all, and
  // none of them may reach the device's log.
  private val libVLC = LibVLC(context, arrayListOf("--network-caching=1500", "--no-stats", "--quiet"))
  val mediaPlayer = MediaPlayer(libVLC)

  // In memory only, like every stream address: it can carry a session token.
  private var uri: String? = null
  private var userAgent: String? = null
  private var referrer: String? = null
  private var length = 0L
  private var lastSecond = -1L
  // How full libVLC's buffer is since the stream opened; null until it says.
  private var buffered: Float? = null
  private var released = false

  init {
    mediaPlayer.setEventListener(
      MediaPlayer.EventListener { event ->
        when (event.type) {
          MediaPlayer.Event.Opening -> {
            buffered = null
            state("loading")
          }
          MediaPlayer.Event.Buffering -> {
            buffered = event.buffering
            if (event.buffering < 100f) state("buffering") else state(if (mediaPlayer.isPlaying) "playing" else "paused")
          }
          // libVLC says it plays as soon as it starts filling its buffer; the
          // picture comes when the buffer is full, and so does "playing".
          MediaPlayer.Event.Playing -> if ((buffered ?: 100f) >= 100f) state("playing")
          MediaPlayer.Event.Paused -> state("paused")
          MediaPlayer.Event.EndReached -> state("ended")
          MediaPlayer.Event.EncounteredError -> emit("error", mapOf("message" to "VLC could not play this stream."))
          MediaPlayer.Event.LengthChanged -> {
            length = event.lengthChanged
            position(mediaPlayer.time)
          }
          MediaPlayer.Event.TimeChanged -> {
            // Once a second is enough for a scrubber and for progress reports.
            val second = event.timeChanged / 1000
            if (second != lastSecond) {
              lastSecond = second
              position(event.timeChanged)
            }
          }
          MediaPlayer.Event.ESAdded, MediaPlayer.Event.ESDeleted -> tracks()
        }
      }
    )
  }

  private fun state(value: String) = emit("state", mapOf("state" to value))

  private fun position(ms: Long) {
    // A live stream has no length, and says so with zero.
    val payload = mutableMapOf<String, Any>("positionMs" to ms.coerceAtLeast(0).toDouble())
    if (length > 0) payload["durationMs"] = length.toDouble()
    emit("position", payload)
  }

  private fun tracks() {
    // Each list starts with libVLC's own "Disable", which is not a track.
    fun listed(tracks: Array<MediaPlayer.TrackDescription>?) =
      tracks?.filter { it.id >= 0 }?.map { mapOf("id" to it.id, "name" to it.name) } ?: emptyList()
    emit("tracks", mapOf("audio" to listed(mediaPlayer.audioTracks), "subtitles" to listed(mediaPlayer.spuTracks)))
  }

  fun load(uri: String, userAgent: String?, referrer: String?, startMs: Double?) {
    this.uri = uri
    this.userAgent = userAgent
    this.referrer = referrer
    open(startMs ?: 0.0)
  }

  /** From the top, or from a place: after its end, libVLC plays a stream again only once it is opened again. */
  fun replay(startMs: Double) {
    if (uri == null) return
    open(startMs)
    mediaPlayer.play()
  }

  private fun open(startMs: Double) {
    val media = Media(libVLC, Uri.parse(uri))
    media.setHWDecoderEnabled(true, false)
    // libVLC sends no arbitrary header: a user agent and a referrer are what it can.
    userAgent?.let { media.addOption(":http-user-agent=$it") }
    referrer?.let { media.addOption(":http-referrer=$it") }
    if (startMs > 0) media.addOption(":start-time=${startMs / 1000.0}")
    length = 0
    lastSecond = -1
    mediaPlayer.media = media
    media.release()
  }

  fun seek(positionMs: Double) {
    mediaPlayer.setTime(positionMs.toLong())
  }

  fun setAudioTrack(id: Int) {
    mediaPlayer.setAudioTrack(id)
  }

  fun setSubtitleTrack(id: Int) {
    mediaPlayer.setSpuTrack(id)
  }

  fun releasePlayer() {
    if (released) return
    released = true
    uri = null
    mediaPlayer.setEventListener(null)
    mediaPlayer.stop()
    if (mediaPlayer.vlcVout.areViewsAttached()) mediaPlayer.detachViews()
    mediaPlayer.release()
    libVLC.release()
  }

  // Not on the app's main queue: a reload cancels it, and the player would leak.
  @OptIn(DelicateCoroutinesApi::class)
  override fun sharedObjectDidRelease() {
    super.sharedObjectDidRelease()
    GlobalScope.launch(Dispatchers.Main) { releasePlayer() }
  }
}
