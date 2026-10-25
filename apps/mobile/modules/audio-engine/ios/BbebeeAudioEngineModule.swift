import AVFoundation
import Foundation

import ExpoModulesCore

/**
 * `BbebeeAudioEngine` — the iOS Expo surface over the in-process libmpv bridge
 * (`BbebeeMpvCore`, which drives the bundled `mpv.framework` directly).
 *
 * The JS adapter (`modules/audio-engine/index.ts`) installs this module's
 * surface as `globalThis.bbebeeMobileMpv` + `globalThis.bbebeeNativeCodec`,
 * the seams the audio engine and `CodecRn` probe. Every method name, argument
 * type and answer shape matches the Android module
 * (`expo.modules.audioengine.BbebeeAudioEngineModule`) one for one — the
 * payload authority is `docs/audio/engine.md` — so `adapter.ts` parses both
 * platforms with the same code.
 *
 * Threading: Expo dispatches `AsyncFunction` bodies onto a shared background
 * queue; every body here hops onto this module's own serial `engineQueue`
 * (the iOS equivalent of Android's dedicated module thread) and resolves the
 * promise from there. The queue serializes all mpv work and bounds long
 * polling (`loadEx` waits for the duration) so the shared Expo queue and the
 * JS thread are never held.
 *
 * Events: none — exactly like Android. The whole surface is polled
 * `AsyncFunction`s; OS interruptions and route changes are observed by the
 * shell (`boot.ts`, react-native-audio-api's `AudioManager`) and published
 * through `ctx.audio.emitInterruption`/`emitRouteChange`, which is why
 * `recoverEngine()` in `mobile-audio.ts` works identically on both platforms.
 */
public class BbebeeAudioEngineModule: Module {
  /// Serializes every mpv touch — the Android "module thread" equivalent.
  private let engineQueue = DispatchQueue(label: "expo.modules.audioengine.engine", qos: .userInitiated)

  private var core: BbebeeMpvCore?

  override public func definition() -> ModuleDefinition {
    Name("BbebeeAudioEngine")

    OnCreate {
      // Boot on the engine queue so every later call (also dispatched there)
      // is ordered after it — the Kotlin module boots in OnCreate on its
      // module thread. Errors surface honestly through `engineStatus`.
      engineQueue.async {
        let engine = self.engine()
        engine.boot(nil)
      }
    }

    OnDestroy {
      engineQueue.async {
        self.core?.shutdown()
      }
    }

    // ------------------------------------------------------------------
    // Playback contract (`bbebeeMobileMpv`)
    // ------------------------------------------------------------------

    // The JS-side recovery seam: destroy and re-create the native context on
    // this module's queue (where every other call runs, so the engine state
    // is never mutated concurrently). True when the new engine came up.
    AsyncFunction("reinit") { (promise: Promise) in
      engineQueue.async {
        let engine = self.core ?? BbebeeMpvCore()
        self.core = engine
        engine.shutdown()
        promise.resolve(engine.boot(nil))
      }
    }

    // `{ok, durationMs, resumed, endedCount[, sampleRate, channels, bitDepth]}`
    // as a JSON string; the JS side parses it (one crossing, no
    // field-by-field bridging).
    AsyncFunction("loadEx") { (uri: String, headers: String?, promise: Promise) in
      engineQueue.async {
        promise.resolve(self.engine().loadEx(uri, headers: headers))
      }
    }

    AsyncFunction("append") { (uri: String, headers: String?, promise: Promise) in
      engineQueue.async {
        promise.resolve(self.engine().appendUri(uri, headers: headers))
      }
    }

    // NaN means "keep the engine's own position" (a paused resume, or the
    // gapless re-bind where a seek back to zero would restart the track).
    AsyncFunction("playAt") { (atMs: Double, promise: Promise) in
      engineQueue.async {
        self.engine().playAtMs(atMs)
        promise.resolve()
      }
    }

    AsyncFunction("pause") { (promise: Promise) in
      engineQueue.async {
        self.engine().pausePlayback()
        promise.resolve()
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      engineQueue.async {
        self.engine().stopPlayback()
        promise.resolve()
      }
    }

    AsyncFunction("seekMs") { (ms: Double, promise: Promise) in
      engineQueue.async {
        self.engine().seekToMs(ms)
        promise.resolve()
      }
    }

    AsyncFunction("setVolume") { (volume01: Double, promise: Promise) in
      engineQueue.async {
        self.engine().setVolume01(volume01)
        promise.resolve()
      }
    }

    AsyncFunction("setMuted") { (muted: Bool, promise: Promise) in
      engineQueue.async {
        self.engine().setMuted(muted)
        promise.resolve()
      }
    }

    AsyncFunction("getState") { (promise: Promise) in
      engineQueue.async {
        promise.resolve(self.engine().stateJson())
      }
    }

    AsyncFunction("engineStatus") { (promise: Promise) in
      engineQueue.async {
        promise.resolve(self.engine().engineStatusJson())
      }
    }

    AsyncFunction("setVisualizer") { (enabled: Bool, fftSize: Int, promise: Promise) in
      engineQueue.async {
        // NSUInteger bridges as UInt on the ObjC side.
        self.engine().setVisualizer(enabled, fftSize: UInt(max(0, fftSize)))
        promise.resolve()
      }
    }

    AsyncFunction("setDspConfig") {
      (af: String, replaygain: String, clip: Bool, preamp: String, fallback: String, promise: Promise) in
      engineQueue.async {
        self.engine().setDspConfigAf(
          af,
          replaygain: replaygain,
          clip: clip,
          preamp: preamp,
          fallback: fallback
        )
        promise.resolve()
      }
    }

    AsyncFunction("setOutputDevice") { (id: String, promise: Promise) in
      engineQueue.async {
        self.engine().setOutputDeviceId(id)
        promise.resolve()
      }
    }

    // mpv's `audio-device-list` in iOS vocabulary ({name, description} rows,
    // `auto` first) — what `core-audio-mpv`'s `listOutputDevices` maps into
    // OutputDevices. Enumeration over AVAudioSession's live route only;
    // route-change publishing belongs to the shell (`boot.ts`), exactly as
    // Android's `AudioDevices` stays enumeration-only over AudioManager.
    AsyncFunction("mpvGetAudioDevices") { (promise: Promise) in
      engineQueue.async {
        // Deliberately independent of the mpv core: the device list describes
        // the OS routes, not the engine (Android answers the same way).
        promise.resolve(AudioDeviceList.listJson())
      }
    }

    AsyncFunction("setStreamPlayback") { (playing: Bool, promise: Promise) in
      engineQueue.async {
        self.engine().setStreamPlayback(playing)
        promise.resolve()
      }
    }

    AsyncFunction("setAudioExclusive") { (exclusive: Bool, promise: Promise) in
      engineQueue.async {
        self.engine().setAudioExclusive(exclusive)
        promise.resolve()
      }
    }

    // Unsigned 0..255 bins — the Kotlin module widens its signed-JNI bytes
    // before they cross into JS; this core writes unsigned bytes directly.
    AsyncFunction("getSpectrum") { (promise: Promise) in
      engineQueue.async {
        let core = self.engine()
        let bins = Int(core.fftBinCount())
        guard bins > 0 else {
          promise.resolve(["ok": false, "frequencyData": [] as [Int], "timeDomainData": [] as [Int]])
          return
        }
        var frequency = [UInt8](repeating: 0, count: bins)
        var timeDomain = [UInt8](repeating: 0, count: bins)
        let ok = core.getSpectrumFrequencyOut(
          &frequency,
          timeDomainOut: &timeDomain,
          count: UInt(bins)
        )
        promise.resolve([
          "ok": ok,
          "frequencyData": frequency.map(Int.init),
          "timeDomainData": timeDomain.map(Int.init),
        ])
      }
    }

    // ------------------------------------------------------------------
    // Codec seam (`bbebeeNativeCodec`): batch artwork + transcode.
    // ------------------------------------------------------------------

    // Positional `(string | null)[]` — base64 per hit, `null` per miss, parsed
    // off the JS thread by a worker pool sized like the desktop fork pool
    // (`min(max(cpus,2),4)`), never rejecting.
    AsyncFunction("readArtworkBatch") { (uris: [String], promise: Promise) in
      guard !uris.isEmpty else {
        promise.resolve([String?]())
        return
      }

      // A per-batch capped queue — behaviorally the Android shared pool
      // without the nested-wait deadlock risk of re-entrant operations.
      let batchQueue = OperationQueue()
      batchQueue.name = "bbebee-artwork-batch"
      batchQueue.maxConcurrentOperationCount =
        min(max(ProcessInfo.processInfo.activeProcessorCount, 2), 4)

      let results = ResultsBox(count: uris.count)
      let operations = uris.enumerated().map { index, uri in
        BlockOperation { results.set(index, AudioArtwork.extractBase64(uri: uri)) }
      }
      let finish = BlockOperation { promise.resolve(results.snapshot()) }
      operations.forEach { finish.addDependency($0) }
      batchQueue.addOperations(operations, waitUntilFinished: false)
      batchQueue.addOperation(finish)
    }

    // The linked iOS engine build carries no FFmpeg transcoder (the Android
    // `libbbebee_audio_jni.so` JNI surface is Android-only), so the codec seam
    // answers honestly instead of pretending: `CodecRn` surfaces the error and
    // falls back to the inherited `core-codec-desktop` implementation.
    AsyncFunction("transcode") { (options: [String: Any?], promise: Promise) in
      let jobId = Self.stringField(options, "jobId")
      let answer =
        "{\"ok\":false,\"jobId\":\"\(Self.jsonEscaped(jobId))\",\"error\":\"\(Self.jsonEscaped(Self.transcodeUnavailableMessage))\"}"
      promise.resolve(answer)
    }

    AsyncFunction("cancelTranscode") { (jobId: String, promise: Promise) in
      // No job registry exists to cancel — false is the honest answer.
      _ = jobId
      promise.resolve(false)
    }

    AsyncFunction("getTranscodeState") { (jobId: String, promise: Promise) in
      let state =
        "{\"jobId\":\"\(Self.jsonEscaped(jobId))\",\"found\":false,\"running\":false,\"done\":true,"
          + "\"ok\":false,\"cancelled\":false,\"progress\":0,\"currentTimeSec\":0,\"durationSec\":0}"
      promise.resolve(state)
    }

    AsyncFunction("getTranscodeCapabilities") { (promise: Promise) in
      promise.resolve("{\"supported\":false,\"encoders\":{}}")
    }
  }

  // MARK: - Engine accessors

  /// The one engine core, created (and booted, if necessary) on demand —
  /// `boot` is idempotent, so an engineStatus that arrives before OnCreate's
  /// boot still answers honestly, and `ensureEngineRecovered`'s reinit path
  /// heals a stub boot.
  private func engine() -> BbebeeMpvCore {
    let engine = core ?? BbebeeMpvCore()
    core = engine
    if !engine.isBooted {
      engine.boot(nil)
    }
    return engine
  }

  // MARK: - Shared answer constants / JSON helpers

  private static let transcodeUnavailableMessage =
    "transcoding is not available in this engine build (iOS)"

  private static func stringField(_ options: [String: Any?], _ key: String) -> String {
    guard let value = options[key] else { return "" }
    return value as? String ?? ""
  }

  /** Minimal JSON string escaping for ids/messages built by hand. */
  fileprivate static func jsonEscaped(_ value: String) -> String {
    var out = ""
    out.reserveCapacity(value.count)
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    return out
  }
}

// MARK: - Thread-safe positional results (batch artwork)

/// One slot per input URI; each worker writes its own index under a lock.
private final class ResultsBox {
  private let lock = NSLock()
  private var values: [String?]

  init(count: Int) {
    values = [String?](repeating: nil, count: count)
  }

  func set(_ index: Int, _ value: String?) {
    lock.lock()
    defer { lock.unlock() }
    if values.indices.contains(index) {
      values[index] = value
    }
  }

  func snapshot() -> [String?] {
    lock.lock()
    defer { lock.unlock() }
    return values
  }
}

// MARK: - Audio device enumeration (mpv `audio-device-list` vocabulary)

/**
 * mpv's `audio-device-list` in iOS vocabulary, the counterpart of Android's
 * `AudioDevices.kt`: `auto` first — the system default route — then every
 * output port of AVAudioSession's live route with a stable `ios/<port>` id
 * and a `product (type)` description. Device ids are stable synthetic keys
 * (`-<n>`-suffixed when one port type shows up twice) rather than per-boot
 * OS identifiers, so a persisted `settings.audioOutputDeviceId` keeps
 * pointing at the same kind of route across launches; ids never collide with
 * the reserved `auto`/`default`.
 *
 * ⚠️ Enumeration only — this answers `mpvGetAudioDevices`; it does not emit
 * device-change events. iOS route changes are published by the shell through
 * react-native-audio-api's `routeChange` system events (`boot.ts`), and
 * per-app output routing is not an OS capability — `setOutputDevice` only
 * forwards `auto` to the engine (see `BbebeeMpvCore.setOutputDeviceId`).
 */
private enum AudioDeviceList {
  static func listJson() -> String {
    var rows: [[String: String]] = [
      ["name": "auto", "description": "System default audio route"],
    ]

    let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
      .sorted { left, right in
        (left.portType.rawValue, left.uid) < (right.portType.rawValue, right.uid)
      }
    var seen: [String: Int] = [:]
    for device in outputs {
      let tag = portTag(device.portType)
      let n = (seen[tag] ?? 0) + 1
      seen[tag] = n
      let name = n == 1 ? "ios/\(tag)" : "ios/\(tag)-\(n)"
      let label = portLabel(device.portType)
      let product = device.portName.trimmingCharacters(in: .whitespacesAndNewlines)
      let description =
        (product.isEmpty || product.caseInsensitiveCompare(label) == .orderedSame)
        ? label : "\(product) (\(label))"
      rows.append(["name": name, "description": description])
    }

    guard let data = try? JSONSerialization.data(withJSONObject: rows),
      let json = String(data: data, encoding: .utf8)
    else {
      return "[{\"name\":\"auto\",\"description\":\"System default audio route\"}]"
    }
    return json
  }

  /// Stable ids per iOS output port; unknown ports degrade to `port_<raw>`
  /// so a new OS constant becomes an extra row instead of a crash.
  private static func portTag(_ port: AVAudioSession.Port) -> String {
    switch port {
    case .builtInSpeaker: return "speaker"
    case .builtInReceiver: return "earpiece"
    case .headphones: return "wired_headphones"
    case .headsetMic: return "wired_headset"
    case .bluetoothA2DP: return "bt_a2dp"
    case .bluetoothLE: return "bt_le"
    case .bluetoothHFP: return "bt_hfp"
    case .airPlay: return "airplay"
    case .carAudio: return "car_audio"
    case .usbAudio: return "usb_audio"
    case .hdmi: return "hdmi"
    case .lineOut: return "line_out"
    case .builtInMic: return "builtin_mic"
    case .builtInLineLevel: return "line_level"
    default: return "port_\(port.rawValue)"
    }
  }

  private static func portLabel(_ port: AVAudioSession.Port) -> String {
    switch port {
    case .builtInSpeaker: return "Built-in speaker"
    case .builtInReceiver: return "Earpiece"
    case .headphones: return "Wired headphones"
    case .headsetMic: return "Wired headset"
    case .bluetoothA2DP: return "Bluetooth audio"
    case .bluetoothLE: return "Bluetooth LE audio"
    case .bluetoothHFP: return "Bluetooth telephony"
    case .airPlay: return "AirPlay"
    case .carAudio: return "Car audio"
    case .usbAudio: return "USB audio"
    case .hdmi: return "HDMI"
    case .lineOut: return "Line out"
    case .builtInMic: return "Built-in microphone"
    case .builtInLineLevel: return "Line level"
    default: return "Audio output"
    }
  }
}

// MARK: - Batch artwork extraction (codec seam)

/**
 * The iOS counterpart of Android's `MediaMetadataRetriever` worker pool: one
 * embedded-cover read per input URI through AVFoundation's tag reader, parsed
 * entirely off the JS thread. Per-file failures (unreadable, unsupported,
 * timed out, no embedded art) answer `nil` — the positional, never-throwing
 * shape `CodecService.readArtworkBatch` promises (the desktop contract spells
 * misses as `undefined`).
 */
private enum AudioArtwork {
  /// One retry-free answer per input URI, positional, `nil` for "no cover".
  private static let perFileTimeoutSeconds: TimeInterval = 10

  /// Extract embedded covers for one `file://` URI or absolute path.
  /// Accepts the same URI vocabulary `ctx.fs` speaks (iOS has no
  /// `content://` equivalent — local files only).
  static func extractBase64(uri: String) -> String? {
    var path = uri
    if path.hasPrefix("file://") {
      path = String(path.dropFirst("file://".count))
    }
    guard FileManager.default.fileExists(atPath: path) else { return nil }

    let asset = AVURLAsset(
      url: URL(fileURLWithPath: path),
      options: [AVURLAssetPreferPreciseDurationAndTimingKey: false]
    )

    final class Box {
      var value: Data?
    }
    let box = Box()
    let boxQueue = DispatchQueue(label: "bbebee-artwork-box")
    let done = DispatchSemaphore(value: 0)

    DispatchQueue.global(qos: .userInitiated).async {
      // The synchronous metadata read is deliberate: the worker pool already
      // runs off the JS thread, one bounded read per file. (The load(.metadata)
      // async replacement needs an await context the pool does not offer.)
      let metadata = asset.metadata
      let items = AVMetadataItem.metadataItems(
        from: metadata,
        filteredByIdentifier: .commonKeyArtwork
      )
      boxQueue.sync {
        box.value = items.first?.dataValue
      }
      done.signal()
    }

    // A hung reader keeps its GCD worker occupied; like Android's
    // `future.cancel(true)` the answer is a miss, never an error.
    guard done.wait(timeout: .now() + perFileTimeoutSeconds) == .success else {
      return nil
    }

    return boxQueue.sync { box.value }?.base64EncodedString()
  }
}
