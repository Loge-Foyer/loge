import AVFoundation
import ExpoModulesCore
import MediaPlayer
import UIKit

/**
 * The device's own volume, which the player's edge slider moves: one volume,
 * the one the side buttons change, not a second one inside an engine.
 *
 * iOS lets an app set it only through MPVolumeView's slider. With such a view
 * in the window the system also leaves its own volume banner out, which is
 * what a player that shows its own slider wants — so the view goes in while
 * the player is open, off the screen, and comes out again after.
 */
public class LogeVolumeModule: Module {
  private var volumeView: MPVolumeView?
  private var observation: NSKeyValueObservation?

  public func definition() -> ModuleDefinition {
    Name("LogeVolume")

    Events("onChange")

    /// The output volume as the system has it, 0 to 1.
    Function("get") { () -> Float in
      AVAudioSession.sharedInstance().outputVolume
    }

    AsyncFunction("set") { (value: Double) in
      self.attach()
      let level = Float(min(1, max(0, value)))
      // The view's slider exists only once the view is in a window; a turn of
      // the run loop later it takes the value.
      DispatchQueue.main.async {
        self.slider()?.setValue(level, animated: false)
      }
    }.runOnQueue(.main)

    AsyncFunction("attach") {
      self.attach()
    }.runOnQueue(.main)

    AsyncFunction("release") {
      self.volumeView?.removeFromSuperview()
      self.volumeView = nil
    }.runOnQueue(.main)

    // The side buttons, the control centre, a headset: whatever moved it.
    OnStartObserving {
      self.observation = AVAudioSession.sharedInstance().observe(\.outputVolume, options: [.new]) { [weak self] _, change in
        guard let volume = change.newValue else { return }
        self?.sendEvent("onChange", ["volume": volume])
      }
    }

    OnStopObserving {
      self.observation?.invalidate()
      self.observation = nil
    }

    OnDestroy {
      self.observation?.invalidate()
      self.observation = nil
      let view = self.volumeView
      self.volumeView = nil
      DispatchQueue.main.async { view?.removeFromSuperview() }
    }
  }

  private func attach() {
    // The session the engines play through. Active, the system reports its
    // volume and every change to it; the engines set the same themselves.
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .moviePlayback)
    try? session.setActive(true)
    guard volumeView == nil, let window = keyWindow() else { return }
    let view = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 1, height: 1))
    view.alpha = 0.0001
    view.isUserInteractionEnabled = false
    window.addSubview(view)
    volumeView = view
  }

  private func slider() -> UISlider? {
    volumeView?.subviews.compactMap { $0 as? UISlider }.first
  }

  private func keyWindow() -> UIWindow? {
    // The app runs the scene life cycle: its windows belong to scenes.
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }
}
