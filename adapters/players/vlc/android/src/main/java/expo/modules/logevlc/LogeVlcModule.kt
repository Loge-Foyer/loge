package expo.modules.logevlc

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class LogeVlcModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LogeVlc")

    Class("Player", LogeVlcPlayer::class) {
      Constructor {
        val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
        // Made on the main thread, which every later call reaches it on.
        runBlocking(appContext.mainQueue.coroutineContext) { LogeVlcPlayer(context, appContext) }
      }

      AsyncFunction("load") { player: LogeVlcPlayer, uri: String, userAgent: String?, referrer: String?, startMs: Double? ->
        player.load(uri, userAgent, referrer, startMs)
      }.runOnQueue(Queues.MAIN)

      Function("play") { player: LogeVlcPlayer ->
        appContext.mainQueue.launch { player.mediaPlayer.play() }
      }
      Function("pause") { player: LogeVlcPlayer ->
        appContext.mainQueue.launch { player.mediaPlayer.pause() }
      }
      Function("replay") { player: LogeVlcPlayer, startMs: Double ->
        appContext.mainQueue.launch { player.replay(startMs) }
      }
      Function("seek") { player: LogeVlcPlayer, positionMs: Double ->
        appContext.mainQueue.launch { player.seek(positionMs) }
      }
      Function("setRate") { player: LogeVlcPlayer, rate: Double ->
        appContext.mainQueue.launch { player.setRate(rate) }
      }
      Function("setVolume") { player: LogeVlcPlayer, volume: Int ->
        appContext.mainQueue.launch { player.setVolume(volume) }
      }
      Function("setAudioTrack") { player: LogeVlcPlayer, id: Int ->
        appContext.mainQueue.launch { player.setAudioTrack(id) }
      }
      Function("setSubtitleTrack") { player: LogeVlcPlayer, id: Int ->
        appContext.mainQueue.launch { player.setSubtitleTrack(id) }
      }
    }

    View(LogeVlcView::class) {
      Prop("player") { view: LogeVlcView, player: LogeVlcPlayer? ->
        view.setPlayer(player)
      }
      Prop("fit") { view: LogeVlcView, fit: String? ->
        view.setFit(fit ?: "contain")
      }
    }
  }
}
