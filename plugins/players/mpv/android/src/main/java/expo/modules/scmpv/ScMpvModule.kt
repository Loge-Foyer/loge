package expo.modules.scmpv

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class ScMpvModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScMpv")

    Class("Player", ScMpvPlayer::class) {
      Constructor {
        val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
        // Made on the main thread, which every later call reaches it on.
        runBlocking(appContext.mainQueue.coroutineContext) { ScMpvPlayer(context, appContext) }
      }

      AsyncFunction("load") { player: ScMpvPlayer, uri: String, headers: Map<String, String>?, startMs: Double? ->
        player.load(uri, headers, startMs)
      }.runOnQueue(Queues.MAIN)

      Function("play") { player: ScMpvPlayer ->
        appContext.mainQueue.launch { player.play() }
      }
      Function("pause") { player: ScMpvPlayer ->
        appContext.mainQueue.launch { player.pause() }
      }
      Function("replay") { player: ScMpvPlayer, startMs: Double ->
        appContext.mainQueue.launch { player.replay(startMs) }
      }
      Function("seek") { player: ScMpvPlayer, positionMs: Double ->
        appContext.mainQueue.launch { player.seek(positionMs) }
      }
      Function("setRate") { player: ScMpvPlayer, rate: Double ->
        appContext.mainQueue.launch { player.setRate(rate) }
      }
      Function("setVolume") { player: ScMpvPlayer, volume: Int ->
        appContext.mainQueue.launch { player.setVolume(volume) }
      }
      Function("setAudioTrack") { player: ScMpvPlayer, id: Int ->
        appContext.mainQueue.launch { player.setAudioTrack(id) }
      }
      Function("setSubtitleTrack") { player: ScMpvPlayer, id: Int ->
        appContext.mainQueue.launch { player.setSubtitleTrack(id) }
      }
    }

    View(ScMpvView::class) {
      Prop("player") { view: ScMpvView, player: ScMpvPlayer? ->
        view.setPlayer(player)
      }
      Prop("fit") { view: ScMpvView, fit: String? ->
        view.setFit(fit ?: "contain")
      }
    }
  }
}
