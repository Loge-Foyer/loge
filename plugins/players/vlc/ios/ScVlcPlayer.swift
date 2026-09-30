import AVFoundation
import ExpoModulesCore
import MobileVLCKit

/**
 One libVLC player per controller, the iOS half of `ScVlcPlayer.kt`.

 Every call reaches it on the main thread, and every event leaves it from
 there: VLCKit 3 calls its delegate on libVLC's own event thread, and reading
 a track list from there re-enters libVLC while it holds its own lock.
 */
public final class ScVlcPlayer: SharedObject, VLCMediaPlayerDelegate {
  // Quiet: libVLC's messages quote the stream's address, token and all, and
  // none of them may reach the device's log. `--quiet` silences libVLC itself;
  // `loggers` is what VLCKit would otherwise hand them to.
  private let vlc = VLCMediaPlayer(options: ["--network-caching=1500", "--no-stats", "--quiet"])

  /// The engine, for this package's view alone.
  var mediaPlayer: VLCMediaPlayer { vlc }

  // In memory only, like every stream address: it can carry a session token.
  private var uri: String?
  private var userAgent: String?
  private var referrer: String?
  private var length: Int64 = 0
  private var lastSecond: Int64 = -1
  private var released = false

  public override init() {
    super.init()
    vlc.libraryInstance.loggers = nil
    vlc.delegate = self
  }

  // MARK: - Events, always from the main thread

  private func onMain(_ body: @escaping () -> Void) {
    if Thread.isMainThread {
      body()
    } else {
      DispatchQueue.main.async(execute: body)
    }
  }

  private func state(_ value: String) {
    emit(event: "state", payload: ["state": value])
  }

  private func position(_ ms: Int64) {
    var payload: [String: Any] = ["positionMs": Double(max(ms, 0))]
    // A live stream has no length, and says so with zero.
    if length > 0 {
      payload["durationMs"] = Double(length)
    }
    emit(event: "position", payload: payload)
  }

  private func tracks() {
    // VLCKit lists a track's id and name in two parallel arrays, and starts
    // each with libVLC's own "Disable" at -1, which is not a track.
    func listed(_ indexes: [Any]?, _ names: [Any]?) -> [[String: Any]] {
      let ids = (indexes ?? []).compactMap { ($0 as? NSNumber)?.intValue }
      let labels = (names ?? []).map { ($0 as? String) ?? "" }
      return zip(ids, labels).filter { $0.0 >= 0 }.map { ["id": $0.0, "name": $0.1] }
    }
    emit(event: "tracks", payload: [
      "audio": listed(vlc.audioTrackIndexes, vlc.audioTrackNames),
      "subtitles": listed(vlc.videoSubTitlesIndexes, vlc.videoSubTitlesNames)
    ])
  }

  // MARK: - VLCMediaPlayerDelegate

  public func mediaPlayerStateChanged(_ aNotification: Notification) {
    onMain { [weak self] in
      guard let self, !self.released else { return }
      switch self.vlc.state {
      case .opening:
        self.state("loading")
      case .buffering:
        // VLCKit 3 throws away libvlc's buffering percentage, so unlike
        // Android there is nothing to gate "playing" on. The engine treats a
        // buffering event before the first frame as loading anyway.
        self.state(self.vlc.isPlaying ? "playing" : "buffering")
      case .playing:
        self.state("playing")
      case .paused:
        self.state("paused")
      case .ended:
        self.state("ended")
      case .error:
        self.emit(event: "error", payload: ["message": "VLC could not play this stream."])
      case .esAdded:
        self.tracks()
      default:
        break
      }
    }
  }

  public func mediaPlayerTimeChanged(_ aNotification: Notification) {
    onMain { [weak self] in
      guard let self, !self.released else { return }
      let ms = Int64(self.vlc.time.intValue)
      // Once a second is enough for a scrubber and for progress reports.
      let second = ms / 1000
      guard second != self.lastSecond else { return }
      self.lastSecond = second
      // iOS has no length event, so the length is read as it settles.
      self.length = Int64(self.vlc.media?.length.intValue ?? 0)
      self.position(ms)
    }
  }

  // MARK: - Commands, all on the main thread

  func load(uri: String, userAgent: String?, referrer: String?, startMs: Double?) {
    self.uri = uri
    self.userAgent = userAgent
    self.referrer = referrer
    // Without a category, playback is silenced by the ringer switch. Android
    // needs no equivalent.
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    try? AVAudioSession.sharedInstance().setActive(true)
    open(startMs ?? 0)
  }

  /// From the top, or from a place: after its end, libVLC plays a stream again only once it is opened again.
  func replay(_ startMs: Double) {
    onMain { [weak self] in
      guard let self, self.uri != nil else { return }
      self.open(startMs)
      self.vlc.play()
    }
  }

  private func open(_ startMs: Double) {
    guard let uri, let url = URL(string: uri) else { return }
    let media = VLCMedia(url: url)
    // libVLC sends no arbitrary header: a user agent and a referrer are what it can.
    if let userAgent { media.addOption(":http-user-agent=\(userAgent)") }
    if let referrer { media.addOption(":http-referrer=\(referrer)") }
    if startMs > 0 { media.addOption(":start-time=\(startMs / 1000.0)") }
    length = 0
    lastSecond = -1
    vlc.media = media
  }

  // A sync `Function` runs on the JS thread, and only `AsyncFunction` can be
  // given a queue — so each of these hops for itself, as the Kotlin's
  // `mainQueue.launch` does.

  func play() {
    onMain { [weak self] in self?.vlc.play() }
  }

  func pause() {
    onMain { [weak self] in self?.vlc.pause() }
  }

  func seek(_ positionMs: Double) {
    onMain { [weak self] in self?.vlc.time = VLCTime(int: Int32(max(positionMs, 0))) }
  }

  func setAudioTrack(_ id: Int) {
    onMain { [weak self] in self?.vlc.currentAudioTrackIndex = Int32(id) }
  }

  /// `-1` turns subtitles off.
  func setSubtitleTrack(_ id: Int) {
    onMain { [weak self] in self?.vlc.currentVideoSubTitleIndex = Int32(id) }
  }

  func releasePlayer() {
    if released { return }
    released = true
    uri = nil
    vlc.delegate = nil
    vlc.stop()
    vlc.drawable = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  public override func sharedObjectWillRelease() {
    // Strong self on purpose: it keeps the player alive until the teardown has
    // run on the main thread, so nothing races with `deinit`.
    onMain {
      self.releasePlayer()
    }
  }
}
