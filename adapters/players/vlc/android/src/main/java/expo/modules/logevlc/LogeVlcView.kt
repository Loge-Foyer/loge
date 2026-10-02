package expo.modules.logevlc

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout

/** Where a controller's pictures go: libVLC's own layout, which it draws into once attached. */
class LogeVlcView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val layout = VLCVideoLayout(context)
  private var player: LogeVlcPlayer? = null
  private var fit = "contain"

  // libVLC sizes its surface itself, and React Native lays out nothing it did not add.
  override val shouldUseAndroidLayout = true

  init {
    addView(layout, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setPlayer(next: LogeVlcPlayer?) {
    if (next === player) return
    detach()
    player = next
    attach()
  }

  fun setFit(value: String) {
    fit = value
    applyFit()
  }

  private fun attach() {
    val current = player ?: return
    if (!isAttachedToWindow || current.mediaPlayer.vlcVout.areViewsAttached()) return
    current.mediaPlayer.attachViews(layout, null, true, false)
    applyFit()
  }

  private fun detach() {
    val current = player ?: return
    if (current.mediaPlayer.vlcVout.areViewsAttached()) current.mediaPlayer.detachViews()
  }

  private fun applyFit() {
    player?.mediaPlayer?.setVideoScale(if (fit == "cover") MediaPlayer.ScaleType.SURFACE_FIT_SCREEN else MediaPlayer.ScaleType.SURFACE_BEST_FIT)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attach()
  }

  override fun onDetachedFromWindow() {
    detach()
    super.onDetachedFromWindow()
  }
}
