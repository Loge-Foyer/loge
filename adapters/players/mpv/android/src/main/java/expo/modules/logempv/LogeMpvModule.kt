package expo.modules.logempv

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class LogeMpvModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LogeMpv")

    Class("Player", LogeMpvPlayer::class) {
      Constructor {
        val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
        // Made on the main thread, which every later call reaches it on.
        runBlocking(appContext.mainQueue.coroutineContext) { LogeMpvPlayer(context, appContext) }
      }

      AsyncFunction("load") { player: LogeMpvPlayer, uri: String, headers: Map<String, String>?, startMs: Double?, cache: Map<String, Any>? ->
        player.load(uri, headers, startMs, cache)
      }.runOnQueue(Queues.MAIN)

      Function("play") { player: LogeMpvPlayer ->
        appContext.mainQueue.launch { player.play() }
      }
      Function("pause") { player: LogeMpvPlayer ->
        appContext.mainQueue.launch { player.pause() }
      }
      Function("replay") { player: LogeMpvPlayer, startMs: Double ->
        appContext.mainQueue.launch { player.replay(startMs) }
      }
      Function("seek") { player: LogeMpvPlayer, positionMs: Double ->
        appContext.mainQueue.launch { player.seek(positionMs) }
      }
      Function("setRate") { player: LogeMpvPlayer, rate: Double ->
        appContext.mainQueue.launch { player.setRate(rate) }
      }
      Function("setSoftwareFallback") { player: LogeMpvPlayer, on: Boolean ->
        appContext.mainQueue.launch { player.setSoftwareFallback(on) }
      }
      Function("setVolume") { player: LogeMpvPlayer, volume: Int ->
        appContext.mainQueue.launch { player.setVolume(volume) }
      }
      Function("setAudioTrack") { player: LogeMpvPlayer, id: Int ->
        appContext.mainQueue.launch { player.setAudioTrack(id) }
      }
      Function("setSubtitleTrack") { player: LogeMpvPlayer, id: Int ->
        appContext.mainQueue.launch { player.setSubtitleTrack(id) }
      }
    }

    View(LogeMpvView::class) {
      Prop("player") { view: LogeMpvView, player: LogeMpvPlayer? ->
        view.setPlayer(player)
      }
      Prop("fit") { view: LogeMpvView, fit: String? ->
        view.setFit(fit ?: "contain")
      }
    }
  }
}
