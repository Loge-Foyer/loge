import ExpoModulesCore
import MobileVLCKit

/**
 Where a controller's pictures go: a plain view libVLC draws into, the iOS
 half of `ScVlcView.kt`. Android hands libVLC a `VLCVideoLayout`, which sizes
 its own surface; here the surface is this view's bounds, so the crop that
 `fit: 'cover'` needs is re-applied whenever the view is laid out.
 */
public final class ScVlcView: ExpoView {
  private let surface = UIView()
  private var player: ScVlcPlayer?
  private var fit = "contain"

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    surface.backgroundColor = .black
    addSubview(surface)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    surface.frame = bounds
    applyFit()
  }

  func setPlayer(_ next: ScVlcPlayer?) {
    if next === player { return }
    detach()
    player = next
    attach()
  }

  func setFit(_ value: String) {
    fit = value
    applyFit()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      detach()
    } else {
      attach()
    }
  }

  private func attach() {
    guard let player, window != nil else { return }
    player.mediaPlayer.drawable = surface
    applyFit()
  }

  private func detach() {
    guard let player else { return }
    if player.mediaPlayer.drawable as? UIView === surface {
      player.mediaPlayer.drawable = nil
    }
  }

  private func applyFit() {
    guard let player else { return }
    let engine = player.mediaPlayer
    // `contain` is libVLC's own default: no crop, and a scale it works out.
    guard fit == "cover", bounds.width > 0, bounds.height > 0 else {
      engine.videoCropGeometry = nil
      return
    }
    // `videoCropGeometry` is a C string libvlc copies, so this one is freed again.
    let geometry = strdup("\(Int(bounds.width.rounded())):\(Int(bounds.height.rounded()))")
    engine.videoCropGeometry = geometry
    free(geometry)
  }
}
