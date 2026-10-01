import ExpoModulesCore

/**
 mpv as an Expo module, member for member with `ScMpvModule.kt`: the same
 module name, the same `Player` class and the same view, so `src/native.ts`,
 `src/engine.ts` and `src/view.tsx` are shared between the platforms unchanged.

 `ScMpvPlayer` and `ScMpvView` are public because the generated
 `ExpoModulesProvider.swift` imports this pod as a module of its own.
 */
public final class ScMpvModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScMpv")

    Class("Player", ScMpvPlayer.self) {
      Constructor { () -> ScMpvPlayer in
        let player = ScMpvPlayer()
        // Loud here beats a player that draws nothing.
        guard player.started else {
          throw Exception(name: "ScMpv", description: "mpv could not start on this device.")
        }
        return player
      }

      AsyncFunction("load") { (player: ScMpvPlayer, uri: String, headers: [String: String]?, startMs: Double?) in
        player.load(uri: uri, headers: headers, startMs: startMs)
      }

      // Each of these returns at once: the player queues the work on its own
      // thread, because every call into mpv waits for its core.
      Function("play") { (player: ScMpvPlayer) in
        player.play()
      }

      Function("pause") { (player: ScMpvPlayer) in
        player.pause()
      }

      Function("replay") { (player: ScMpvPlayer, startMs: Double) in
        player.replay(startMs)
      }

      Function("seek") { (player: ScMpvPlayer, positionMs: Double) in
        player.seek(positionMs)
      }

      Function("setRate") { (player: ScMpvPlayer, rate: Double) in
        player.setRate(rate)
      }

      Function("setPictureInPicture") { (player: ScMpvPlayer, on: Bool) in
        player.setPictureInPicture(on)
      }

      Function("setSoftwareFallback") { (player: ScMpvPlayer, on: Bool) in
        player.setSoftwareFallback(on)
      }

      Function("setVolume") { (player: ScMpvPlayer, volume: Int) in
        player.setVolume(volume)
      }

      Function("setAudioTrack") { (player: ScMpvPlayer, id: Int) in
        player.setAudioTrack(id)
      }

      Function("setSubtitleTrack") { (player: ScMpvPlayer, id: Int) in
        player.setSubtitleTrack(id)
      }
    }

    // The only view here, so it is the module's default one, which is what
    // `requireNativeView('ScMpv')` asks for.
    View(ScMpvView.self) {
      Prop("player") { (view: ScMpvView, player: ScMpvPlayer?) in
        view.setPlayer(player)
      }

      Prop("fit") { (view: ScMpvView, fit: String?) in
        view.setFit(fit ?? "contain")
      }
    }
  }
}
