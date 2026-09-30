package expo.modules.scmpv

import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Where a controller's pictures go: a surface mpv draws into with OpenGL ES,
 * handed over once Android has made it and taken back before it goes.
 */
class ScMpvView(context: Context, appContext: AppContext) : ExpoView(context, appContext), SurfaceHolder.Callback {
  private val surfaceView = SurfaceView(context)
  private var player: ScMpvPlayer? = null
  private var fit = "contain"
  private var width = 0
  private var height = 0
  private var attached = false

  // mpv sizes its own surface, and React Native lays out nothing it did not add.
  override val shouldUseAndroidLayout = true

  init {
    addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    surfaceView.holder.addCallback(this)
  }

  fun setPlayer(next: ScMpvPlayer?) {
    if (next === player) return
    player?.detachSurface()
    attached = false
    player = next
    attach()
  }

  fun setFit(value: String) {
    fit = value
    player?.setFit(value)
  }

  private fun attach() {
    val current = player ?: return
    val surface = surfaceView.holder.surface
    if (attached || !surface.isValid || width <= 0 || height <= 0) return
    attached = true
    current.attachSurface(surface, width, height)
    current.setFit(fit)
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    attached = false
    attach()
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    this.width = width
    this.height = height
    // The first size is what makes the surface usable: attach on it, and from
    // then on only say how big it is — turning the device comes through here.
    attach()
    player?.surfaceSize(width, height)
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    width = 0
    height = 0
    attached = false
    player?.detachSurface()
  }
}
