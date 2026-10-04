import ExpoModulesCore
import UIKit

/**
 Keeps the Apple TV remote's Menu button for React Native while a screen
 needs it.

 A pushed screen sits in a UINavigationController, and the controller's own
 Menu tap pops it before React Native hears the press — even with
 `TVEventControl.enableTVMenuKey()` on (react-native-screens #4618). While held,
 every navigation controller's Menu recognizer is off, and kept off, because
 UIKit switches it on again as screens come and go. The same thing as
 react-native-screens' `disableDefaultMenuAction` (#4665), which no release
 carries yet: remove this once one does.
 */
public class LogeTvMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LogeTvMenu")

    /// On: switch off every navigation controller's Menu tap, the ones that
    /// appeared since the last call included. Off: give them back as they were.
    Function("hold") { (on: Bool) in
      DispatchQueue.main.async { MenuHold.shared.set(on) }
    }

    // A reload starts the app's count again from nothing; Menu must not stay taken meanwhile.
    OnDestroy {
      DispatchQueue.main.async { MenuHold.shared.set(false) }
    }
  }
}

private final class MenuHold {
  static let shared = MenuHold()

  private struct Taken {
    weak var recognizer: UIGestureRecognizer?
    let wasEnabled: Bool
    let observation: NSKeyValueObservation
  }

  private var held = false
  private var taken: [Taken] = []

  func set(_ on: Bool) {
    #if os(tvOS)
    held = on
    if on { take() } else { giveBack() }
    #endif
  }

  #if os(tvOS)
  private func take() {
    let menu = NSNumber(value: UIPress.PressType.menu.rawValue)
    for controller in navigationControllers() {
      for case let tap as UITapGestureRecognizer in controller.view.gestureRecognizers ?? [] where tap.allowedPressTypes.contains(menu) {
        if !taken.contains(where: { $0.recognizer === tap }) {
          let observation = tap.observe(\.isEnabled, options: [.new]) { [weak self] recognizer, _ in
            guard let self, self.held, recognizer.isEnabled else { return }
            DispatchQueue.main.async {
              if self.held { recognizer.isEnabled = false }
            }
          }
          taken.append(Taken(recognizer: tap, wasEnabled: tap.isEnabled, observation: observation))
        }
        tap.isEnabled = false
      }
    }
  }

  private func giveBack() {
    for each in taken {
      each.observation.invalidate()
      each.recognizer?.isEnabled = each.wasEnabled
    }
    taken.removeAll()
  }

  /// Every navigation controller under the app's windows, presented ones included. Windows belong to scenes from iOS and tvOS 27 on.
  private func navigationControllers() -> [UINavigationController] {
    var found: [UINavigationController] = []
    func visit(_ controller: UIViewController?) {
      guard let controller else { return }
      if let navigation = controller as? UINavigationController { found.append(navigation) }
      controller.children.forEach(visit)
      visit(controller.presentedViewController)
    }
    for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
      scene.windows.forEach { visit($0.rootViewController) }
    }
    return found
  }
  #endif
}
