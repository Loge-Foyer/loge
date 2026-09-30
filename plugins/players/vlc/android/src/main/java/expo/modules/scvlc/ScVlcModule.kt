package expo.modules.scvlc

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class ScVlcModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScVlc")

    Class("Player", ScVlcPlayer::class) {
      Constructor {
        val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
        // Made on the main thread, which every later call reaches it on.
        runBlocking(appContext.mainQueue.coroutineContext) { ScVlcPlayer(context, appContext) }
      }

      AsyncFunction("load") { player: ScVlcPlayer, uri: String, userAgent: String?, referrer: String?, startMs: Double? ->
        player.load(uri, userAgent, referrer, startMs)
      }.runOnQueue(Queues.MAIN)

      Function("play") { player: ScVlcPlayer ->
        appContext.mainQueue.launch { player.mediaPlayer.play() }
      }
      Function("pause") { player: ScVlcPlayer ->
        appContext.mainQueue.launch { player.mediaPlayer.pause() }
      }
      Function("replay") { player: ScVlcPlayer, startMs: Double ->
        appContext.mainQueue.launch { player.replay(startMs) }
      }
      Function("seek") { player: ScVlcPlayer, positionMs: Double ->
        appContext.mainQueue.launch { player.seek(positionMs) }
      }
      Function("setAudioTrack") { player: ScVlcPlayer, id: Int ->
        appContext.mainQueue.launch { player.setAudioTrack(id) }
      }
      Function("setSubtitleTrack") { player: ScVlcPlayer, id: Int ->
        appContext.mainQueue.launch { player.setSubtitleTrack(id) }
      }
    }

    View(ScVlcView::class) {
      Prop("player") { view: ScVlcView, player: ScVlcPlayer? ->
        view.setPlayer(player)
      }
      Prop("fit") { view: ScVlcView, fit: String? ->
        view.setFit(fit ?: "contain")
      }
    }
  }
}
