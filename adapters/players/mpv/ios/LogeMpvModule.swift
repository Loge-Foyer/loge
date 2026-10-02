import ExpoModulesCore

/**
 mpv as an Expo module, member for member with `LogeMpvModule.kt`: the same
 module name, the same `Player` class and the same view, so `src/native.ts`,
 `src/engine.ts` and `src/view.tsx` are shared between the platforms unchanged.

 `LogeMpvPlayer` and `LogeMpvView` are public because the generated
 `ExpoModulesProvider.swift` imports this pod as a module of its own.
 */
public final class LogeMpvModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LogeMpv")

    Class("Player", LogeMpvPlayer.self) {
      Constructor { () -> LogeMpvPlayer in
        let player = LogeMpvPlayer()
        // Loud here beats a player that draws nothing.
        guard player.started else {
          throw Exception(name: "LogeMpv", description: "mpv could not start on this device.")
        }
        return player
      }

      AsyncFunction("load") { (player: LogeMpvPlayer, uri: String, headers: [String: String]?, startMs: Double?) in
        player.load(uri: uri, headers: headers, startMs: startMs)
      }

      // Each of these returns at once: the player queues the work on its own
      // thread, because every call into mpv waits for its core.
      Function("play") { (player: LogeMpvPlayer) in
        player.play()
      }

      Function("pause") { (player: LogeMpvPlayer) in
        player.pause()
      }

      Function("replay") { (player: LogeMpvPlayer, startMs: Double) in
        player.replay(startMs)
      }

      Function("seek") { (player: LogeMpvPlayer, positionMs: Double) in
        player.seek(positionMs)
      }

      Function("setRate") { (player: LogeMpvPlayer, rate: Double) in
        player.setRate(rate)
      }

      Function("setPictureInPicture") { (player: LogeMpvPlayer, on: Bool) in
        player.setPictureInPicture(on)
      }

      Function("setSoftwareFallback") { (player: LogeMpvPlayer, on: Bool) in
        player.setSoftwareFallback(on)
      }

      Function("setVolume") { (player: LogeMpvPlayer, volume: Int) in
        player.setVolume(volume)
      }

      Function("setAudioTrack") { (player: LogeMpvPlayer, id: Int) in
        player.setAudioTrack(id)
      }

      Function("setSubtitleTrack") { (player: LogeMpvPlayer, id: Int) in
        player.setSubtitleTrack(id)
      }
    }

    // The only view here, so it is the module's default one, which is what
    // `requireNativeView('LogeMpv')` asks for.
    View(LogeMpvView.self) {
      Prop("player") { (view: LogeMpvView, player: LogeMpvPlayer?) in
        view.setPlayer(player)
      }

      Prop("fit") { (view: LogeMpvView, fit: String?) in
        view.setFit(fit ?? "contain")
      }
    }
  }
}
