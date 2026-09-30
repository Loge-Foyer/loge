import AVFoundation
import ExpoModulesCore
import MPVKit

/**
 One mpv core per controller, the iOS half of `ScMpvPlayer.kt`.

 **Every call into mpv waits for its core**, which while a file opens is busy
 for seconds at a time. So none of them is made on the main thread: they go one
 after another on this player's own serial queue, and what mpv answers becomes
 an event on the main thread, where the listeners are.

 Unlike Android, the video output never comes and goes. mpv draws into an
 `AVSampleBufferDisplayLayer` this player owns, handed over as `wid` *before*
 `mpv_initialize`, and the view merely puts that layer on screen. Android has
 to attach and detach a `Surface` the system gives and takes away, and pause
 around it because mpv stops answering when its video output goes mid-play;
 none of that applies here.

 Nothing asks mpv for a log message — see `ScMpv.podspec`. mpv only generates
 them for a client that asked, so the address of a stream, with whatever token
 is in it, never reaches the device log.
 */
public final class ScMpvPlayer: SharedObject {
  /// Where mpv draws. The view puts it on screen; it belongs to the player.
  let displayLayer = AVSampleBufferDisplayLayer()

  private var mpv: OpaquePointer?
  private let work = DispatchQueue(label: "sc-mpv", qos: .userInitiated)
  private var events: Thread?
  // The event thread must be out of `mpv_wait_event` before the core goes, or
  // it waits on a handle that has been destroyed. `exiting` is read on that
  // thread and written on another, so it is behind a lock; `stopped` is how
  // the teardown waits for it, as Android's `pthread_join` does.
  private let leaving = NSLock()
  private var exiting = false
  private let stopped = DispatchSemaphore(value: 0)

  // Read and written on `work` alone, except where marked.
  private var loading = false
  private var loaded = false
  private var durationMs: Int64 = 0
  private var buffering = false
  private var paused = false
  private var ended = false
  private var lastSecond: Int64 = -1
  private var released = false
  private var stalled: DispatchWorkItem?

  public override init() {
    super.init()
    // mpv parses numbers itself, and a comma for a decimal point breaks it.
    setlocale(LC_NUMERIC, "C")
    guard let handle = mpv_create() else { return }
    mpv = handle

    // No config, no scripts, no OSD, no key handling: the app draws the
    // controls, and nothing on the device may change how this player behaves.
    option("config", "no")
    option("osc", "no")
    option("osd-level", "0")
    option("input-default-bindings", "no")
    option("input-vo-keyboard", "no")
    option("ytdl", "no")
    // Nothing beside the stream is opened: no sidecar subtitle or audio file.
    option("sub-auto", "no")
    option("audio-file-auto", "no")
    option("terminal", "no")
    option("idle", "yes")

    // The layer is mpv's window, set before init as its video output wants.
    var window = Int64(Int(bitPattern: Unmanaged.passUnretained(displayLayer).toOpaque()))
    mpv_set_option(handle, "wid", MPV_FORMAT_INT64, &window)
    option("vo", "avfoundation")
    // mpv draws the subtitles into the same layer as the picture.
    option("avfoundation-composite-osd", "yes")
    option("ao", "audiounit")
    // A phone has two speakers, and asking for more is where mpv stops
    // answering on a device that has none.
    option("audio-channels", "stereo")
    // VideoToolbox, unlike Android's decoder, is worth trusting here — and it
    // falls back to FFmpeg's own decoders rather than handing back no frame.
    option("hwdec", "videotoolbox")
    option("hwdec-codecs", "all")
    option("hwdec-software-fallback", "yes")
    // At the end, stay on the last frame instead of shutting the core down, so
    // playing again is a seek rather than another open.
    option("keep-open", "always")

    guard mpv_initialize(handle) >= 0 else {
      mpv_terminate_destroy(handle)
      mpv = nil
      return
    }

    observe("time-pos", MPV_FORMAT_DOUBLE)
    observe("duration", MPV_FORMAT_DOUBLE)
    observe("pause", MPV_FORMAT_FLAG)
    observe("paused-for-cache", MPV_FORMAT_FLAG)
    observe("eof-reached", MPV_FORMAT_FLAG)
    observe("track-list", MPV_FORMAT_NONE)

    let thread = Thread { [weak self] in self?.pump() }
    thread.name = "sc-mpv-events"
    events = thread
    thread.start()
  }

  /// Whether the core started at all. An `ScMpvModule` constructor that gets
  /// `false` throws, because a player that draws nothing is worse than a loud
  /// failure.
  var started: Bool { mpv != nil }

  // MARK: - Talking to mpv

  private func option(_ name: String, _ value: String) {
    guard let mpv else { return }
    mpv_set_option_string(mpv, name, value)
  }

  private func observe(_ name: String, _ format: mpv_format) {
    guard let mpv else { return }
    mpv_observe_property(mpv, 0, name, format)
  }

  /// One after another, off the main thread; nothing more once the core is let go.
  private func onMpv(_ block: @escaping () -> Void) {
    if released { return }
    work.async { [weak self] in
      guard let self, !self.released, self.mpv != nil else { return }
      block()
    }
  }

  private func command(_ parts: [String]) {
    guard let mpv else { return }
    // mpv takes a null-terminated `const char **`, and owns none of it.
    let copies: [UnsafeMutablePointer<CChar>?] = parts.map { strdup($0) }
    defer { for copy in copies { free(copy) } }
    var arguments: [UnsafePointer<CChar>?] = copies.map { pointer in pointer.map { UnsafePointer<CChar>($0) } }
    arguments.append(nil)
    arguments.withUnsafeMutableBufferPointer { buffer in
      _ = mpv_command(mpv, buffer.baseAddress)
    }
  }

  private func setString(_ name: String, _ value: String) {
    guard let mpv else { return }
    var copy = strdup(value)
    mpv_set_property(mpv, name, MPV_FORMAT_STRING, &copy)
    free(copy)
  }

  private func setInt(_ name: String, _ value: Int64) {
    guard let mpv else { return }
    var wide = value
    mpv_set_property(mpv, name, MPV_FORMAT_INT64, &wide)
  }

  private func setDouble(_ name: String, _ value: Double) {
    guard let mpv else { return }
    var number = value
    mpv_set_property(mpv, name, MPV_FORMAT_DOUBLE, &number)
  }

  private func setFlag(_ name: String, _ value: Bool) {
    guard let mpv else { return }
    var flag: Int32 = value ? 1 : 0
    mpv_set_property(mpv, name, MPV_FORMAT_FLAG, &flag)
  }

  private func string(_ name: String) -> String? {
    guard let mpv else { return nil }
    var value: UnsafeMutablePointer<CChar>?
    guard mpv_get_property(mpv, name, MPV_FORMAT_STRING, &value) >= 0, let value else { return nil }
    let answer = String(cString: value)
    mpv_free(value)
    return answer
  }

  private func int(_ name: String, _ fallback: Int64) -> Int64 {
    guard let mpv else { return fallback }
    var value: Int64 = 0
    return mpv_get_property(mpv, name, MPV_FORMAT_INT64, &value) >= 0 ? value : fallback
  }

  // MARK: - What mpv says, from its own thread

  private func isExiting() -> Bool {
    leaving.lock()
    defer { leaving.unlock() }
    return exiting
  }

  private func pump() {
    guard let mpv else {
      stopped.signal()
      return
    }
    defer { stopped.signal() }
    while !isExiting() {
      guard let event = mpv_wait_event(mpv, -1.0) else { continue }
      let id = event.pointee.event_id
      if id == MPV_EVENT_SHUTDOWN { break }
      if id == MPV_EVENT_NONE { continue }
      if id == MPV_EVENT_PROPERTY_CHANGE {
        guard let raw = event.pointee.data else { continue }
        let property = raw.assumingMemoryBound(to: mpv_event_property.self).pointee
        guard let name = property.name.map({ String(cString: $0) }) else { continue }
        switch property.format {
        case MPV_FORMAT_DOUBLE:
          if let data = property.data { let value = data.assumingMemoryBound(to: Double.self).pointee; onMpv { [weak self] in self?.onNumber(name, value) } }
        case MPV_FORMAT_FLAG:
          if let data = property.data { let value = data.assumingMemoryBound(to: Int32.self).pointee != 0; onMpv { [weak self] in self?.onFlag(name, value) } }
        default:
          onMpv { [weak self] in if name == "track-list" { self?.tracks() } }
        }
      } else {
        onMpv { [weak self] in self?.onEvent(id) }
      }
    }
  }

  private func onEvent(_ id: mpv_event_id) {
    switch id {
    case MPV_EVENT_START_FILE:
      state("loading")
    case MPV_EVENT_FILE_LOADED:
      loading = false
      loaded = true
      tracks()
    // The first frame is up, here or after a seek: what mpv is doing now is
    // whatever `pause` says.
    case MPV_EVENT_PLAYBACK_RESTART:
      if loaded { fromPause() }
    case MPV_EVENT_END_FILE:
      if loading {
        loading = false
        // Why the file ended does not reach here, so a file that never loaded
        // is how a failure is known. The message never quotes the address.
        emitOnMain("error", ["message": "mpv could not play this stream."])
      }
    default:
      break
    }
  }

  private func onNumber(_ property: String, _ value: Double) {
    switch property {
    case "duration":
      durationMs = Int64(value * 1000)
    case "time-pos":
      let ms = Int64(value * 1000)
      // Once a second is enough for a scrubber and for progress reports.
      let second = ms / 1000
      if second != lastSecond {
        if lastSecond < 0 { cancelStall() }
        lastSecond = second
        position(ms)
      }
    default:
      break
    }
  }

  private func onFlag(_ property: String, _ value: Bool) {
    switch property {
    case "eof-reached":
      ended = value
      guard loaded else { return }
      if value { state("ended") } else { fromPause() }
    case "paused-for-cache":
      buffering = value
      guard loaded else { return }
      if value { state("buffering") } else { fromPause() }
    case "pause":
      paused = value
      if loaded && !buffering { fromPause() }
    default:
      break
    }
  }

  private func fromPause() {
    if ended { return }
    state(paused ? "paused" : "playing")
  }

  private func state(_ value: String) {
    emitOnMain("state", ["state": value])
  }

  private func position(_ ms: Int64) {
    var payload: [String: Any] = ["positionMs": Double(max(ms, 0))]
    // A live stream has no length, and mpv leaves it at zero.
    if durationMs > 0 { payload["durationMs"] = Double(durationMs) }
    emitOnMain("position", payload)
  }

  /// mpv names every track's language and codec, so the app's labels are the file's own.
  private func tracks() {
    let count = int("track-list/count", 0)
    var audio: [[String: Any]] = []
    var subtitles: [[String: Any]] = []
    for index in 0..<count {
      guard let type = string("track-list/\(index)/type"), type == "audio" || type == "sub" else { continue }
      let id = int("track-list/\(index)/id", -1)
      if id < 0 { continue }
      var track: [String: Any] = ["id": Int(id)]
      if let title = string("track-list/\(index)/title") { track["title"] = title }
      if let language = string("track-list/\(index)/lang") { track["language"] = language }
      if let codec = string("track-list/\(index)/codec") { track["codec"] = codec }
      if type == "audio" { audio.append(track) } else { subtitles.append(track) }
    }
    emitOnMain("tracks", ["audio": audio, "subtitles": subtitles])
  }

  private func emitOnMain(_ name: String, _ payload: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      guard let self, !self.released else { return }
      self.emit(event: name, payload: payload)
    }
  }

  // MARK: - What JavaScript asks for

  func load(uri: String, headers: [String: String]?, startMs: Double?) {
    state("loading")
    watch()
    // Everything this player knows about a file is kept on the one thread that
    // talks to mpv, and so is set there.
    onMpv { [weak self] in
      guard let self else { return }
      self.loading = true
      self.loaded = false
      self.buffering = false
      self.ended = false
      self.durationMs = 0
      self.lastSecond = -1
      self.applyHeaders(headers)
      // `start` applies to the next file, and is set on every load so the one
      // before cannot linger.
      self.setString("start", startMs != nil && startMs! > 0 ? "+\(startMs! / 1000.0)" : "none")
      self.command(["loadfile", uri])
    }
  }

  func play() { onMpv { [weak self] in self?.setFlag("pause", false) } }

  func pause() { onMpv { [weak self] in self?.setFlag("pause", true) } }

  /// After the end mpv holds the last frame, so playing again is a seek and an unpause.
  func replay(_ startMs: Double) {
    onMpv { [weak self] in
      guard let self else { return }
      self.command(["seek", "\(startMs / 1000.0)", "absolute+exact"])
      self.setFlag("pause", false)
    }
  }

  func seek(_ positionMs: Double) {
    onMpv { [weak self] in self?.command(["seek", "\(positionMs / 1000.0)", "absolute+exact"]) }
  }

  func setAudioTrack(_ id: Int) {
    onMpv { [weak self] in
      guard let self else { return }
      if id < 0 { self.setString("aid", "no") } else { self.setInt("aid", Int64(id)) }
    }
  }

  func setSubtitleTrack(_ id: Int) {
    onMpv { [weak self] in
      guard let self else { return }
      if id < 0 { self.setString("sid", "no") } else { self.setInt("sid", Int64(id)) }
    }
  }

  /// `cover` fills the screen and crops; `contain` fits the whole picture in.
  func setFit(_ fit: String) {
    onMpv { [weak self] in self?.setDouble("panscan", fit == "cover" ? 1.0 : 0.0) }
  }

  /**
   mpv sends any header a stream needs. Its list options take each item as
   `%<bytes>%<item>`, which is what keeps a header holding a comma — a cookie,
   most of all — from being read as two.
   */
  private func applyHeaders(_ headers: [String: String]?) {
    var userAgent = ""
    var referrer = ""
    var fields: [String] = []
    for (name, value) in headers ?? [:] {
      switch name.lowercased() {
      case "user-agent": userAgent = value
      case "referer", "referrer": referrer = value
      default:
        let field = "\(name): \(value)"
        fields.append("%\(field.utf8.count)%\(field)")
      }
    }
    setString("user-agent", userAgent)
    setString("referrer", referrer)
    setString("http-header-fields", fields.joined(separator: ","))
  }

  // MARK: - Stalling, and the end

  /**
   A decoder that takes a stream and then hands back no frame leaves mpv
   loading for ever — and the screen with a spinner and nothing to read. Ten
   seconds without a position is that, said out loud. The first position calls
   it off.
   */
  private func watch() {
    cancelStall()
    let alarm = DispatchWorkItem { [weak self] in
      guard let self, !self.released, self.lastSecond < 0 else { return }
      self.emit(event: "error", payload: ["message": "mpv could not play this stream on this device."])
    }
    stalled = alarm
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: alarm)
  }

  private func cancelStall() {
    let alarm = stalled
    stalled = nil
    DispatchQueue.main.async { alarm?.cancel() }
  }

  func releasePlayer() {
    if released { return }
    released = true
    cancelStall()
    guard let handle = mpv else { return }
    mpv = nil
    leaving.lock()
    exiting = true
    leaving.unlock()
    // Out of `mpv_wait_event`, so the loop sees `exiting` and leaves.
    mpv_wakeup(handle)
    // Behind whatever was already asked of mpv, so nothing is in the core when
    // it goes — and behind the event thread, which must be gone first.
    work.async { [stopped] in
      stopped.wait()
      mpv_terminate_destroy(handle)
    }
  }

  public override func sharedObjectWillRelease() {
    // Strong self on purpose: it keeps the player alive until the teardown has
    // run, so nothing races with `deinit`.
    DispatchQueue.main.async {
      self.releasePlayer()
    }
  }
}
