import ExpoModulesCore

/**
 libVLC as an Expo module, member for member with `ScVlcModule.kt`: the same
 module name, the same `Player` class and the same view, so `src/native.ts`,
 `src/engine.ts` and `src/view.tsx` are shared between the platforms unchanged.

 `ScVlcPlayer` and `ScVlcView` are public because the generated
 `ExpoModulesProvider.swift` imports this pod as a module of its own.
 */
public final class ScVlcModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScVlc")

    Class("Player", ScVlcPlayer.self) {
      Constructor {
        ScVlcPlayer()
      }

      AsyncFunction("load") { (player: ScVlcPlayer, uri: String, userAgent: String?, referrer: String?, startMs: Double?) in
        player.load(uri: uri, userAgent: userAgent, referrer: referrer, startMs: startMs)
      }.runOnQueue(.main)

      Function("play") { (player: ScVlcPlayer) in
        player.play()
      }

      Function("pause") { (player: ScVlcPlayer) in
        player.pause()
      }

      Function("replay") { (player: ScVlcPlayer, startMs: Double) in
        player.replay(startMs)
      }

      Function("seek") { (player: ScVlcPlayer, positionMs: Double) in
        player.seek(positionMs)
      }

      Function("setRate") { (player: ScVlcPlayer, rate: Double) in
        player.setRate(rate)
      }

      Function("setAudioTrack") { (player: ScVlcPlayer, id: Int) in
        player.setAudioTrack(id)
      }

      Function("setSubtitleTrack") { (player: ScVlcPlayer, id: Int) in
        player.setSubtitleTrack(id)
      }
    }

    // The only view here, so it is the module's default one, which is what
    // `requireNativeView('ScVlc')` asks for.
    View(ScVlcView.self) {
      Prop("player") { (view: ScVlcView, player: ScVlcPlayer?) in
        view.setPlayer(player)
      }

      Prop("fit") { (view: ScVlcView, fit: String?) in
        view.setFit(fit ?? "contain")
      }
    }
  }
}
