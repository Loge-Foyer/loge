import AVFoundation
import ExpoModulesCore

/**
 Where a controller's pictures go, the iOS half of `LogeMpvView.kt`.

 Android has to hand mpv a `Surface` the system creates and destroys, and pause
 around it because mpv stops answering when its video output goes mid-play.
 Here the layer belongs to the player and outlives every view, so this only
 puts it on screen and keeps it the right size.
 */
public final class LogeMpvView: ExpoView {
  private var player: LogeMpvPlayer?
  private var fit = "contain"

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    // The layer is not the view's own, so Core Animation will not size it.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    player?.displayLayer.frame = bounds
    CATransaction.commit()
  }

  func setPlayer(_ next: LogeMpvPlayer?) {
    if next === player { return }
    player?.displayLayer.removeFromSuperlayer()
    player = next
    guard let next else { return }
    next.displayLayer.removeFromSuperlayer()
    next.displayLayer.frame = bounds
    layer.addSublayer(next.displayLayer)
    next.setFit(fit)
  }

  func setFit(_ value: String) {
    fit = value
    player?.setFit(value)
  }
}
