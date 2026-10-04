import ExpoModulesCore

/**
 libVLC as an Expo module, member for member with `LogeVlcModule.kt`: the same
 module name, the same `Player` class and the same view, so `src/native.ts`,
 `src/engine.ts` and `src/view.tsx` are shared between the platforms unchanged.

 `LogeVlcPlayer` and `LogeVlcView` are public because the generated
 `ExpoModulesProvider.swift` imports this pod as a module of its own.
 */
public final class LogeVlcModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LogeVlc")

    Class("Player", LogeVlcPlayer.self) {
      Constructor {
        LogeVlcPlayer()
      }

      AsyncFunction("load") { (player: LogeVlcPlayer, uri: String, userAgent: String?, referrer: String?, startMs: Double?, cachingMs: Double?) in
        player.load(uri: uri, userAgent: userAgent, referrer: referrer, startMs: startMs, cachingMs: cachingMs)
      }.runOnQueue(.main)

      Function("play") { (player: LogeVlcPlayer) in
        player.play()
      }

      Function("pause") { (player: LogeVlcPlayer) in
        player.pause()
      }

      Function("replay") { (player: LogeVlcPlayer, startMs: Double) in
        player.replay(startMs)
      }

      Function("seek") { (player: LogeVlcPlayer, positionMs: Double) in
        player.seek(positionMs)
      }

      Function("setRate") { (player: LogeVlcPlayer, rate: Double) in
        player.setRate(rate)
      }

      Function("setVolume") { (player: LogeVlcPlayer, volume: Int) in
        player.setVolume(volume)
      }

      Function("setAudioTrack") { (player: LogeVlcPlayer, id: Int) in
        player.setAudioTrack(id)
      }

      Function("setSubtitleTrack") { (player: LogeVlcPlayer, id: Int) in
        player.setSubtitleTrack(id)
      }
    }

    // The only view here, so it is the module's default one, which is what
    // `requireNativeView('LogeVlc')` asks for.
    View(LogeVlcView.self) {
      Prop("player") { (view: LogeVlcView, player: LogeVlcPlayer?) in
        view.setPlayer(player)
      }

      Prop("fit") { (view: LogeVlcView, fit: String?) in
        view.setFit(fit ?? "contain")
      }
    }
  }
}
