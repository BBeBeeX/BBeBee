package expo.modules.audioengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.bbebee.audio.BBeBeeAudioEngine

/**
 * `BbebeeAudioEngine` — the Expo surface over the in-process libmpv bridge.
 *
 * The JS adapter (`modules/audio-engine/index.ts`) installs this as
 * `globalThis.bbebeeMobileMpv`, the seam the audio engine probes; the method
 * names and payloads are the contract table in
 * `B_Be_Bee/docs/audio/engine.md`.
 *
 * Everything is an `AsyncFunction` on purpose: the JNI calls run on the
 * module's dedicated thread, which is what lets `loadEx` poll mpv for the
 * duration without ever blocking the JS thread.
 */
class BbebeeAudioEngineModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("BbebeeAudioEngine")

        OnCreate {
            // No config dir: mpv keeps its state in memory, which is what a
            // player without a writable mpv config story wants anyway.
            BBeBeeAudioEngine.nativeInit(null)
        }
        OnDestroy {
            BBeBeeAudioEngine.nativeDestroy()
        }

        // The JS-side recovery seam: destroy and re-create the native context
        // on this module's thread (where every other AsyncFunction runs, so
        // the JNI mutex is never held across the JS thread). OnCreate's
        // nativeInit is the only other place the engine comes up, and a wedge
        // — a lost mpv core, a context destroyed without a re-init — has no
        // second boot to rely on. True when the new engine came up.
        AsyncFunction("reinit") {
            BBeBeeAudioEngine.nativeDestroy()
            BBeBeeAudioEngine.nativeInit(null)
        }

        // `{ok, durationMs, resumed, endedCount}` as a JSON string; the JS
        // side parses it (one crossing, no field-by-field bridging).
        AsyncFunction("loadEx") { uri: String, headers: String? ->
            BBeBeeAudioEngine.nativeLoadEx(uri, headers)
        }

        AsyncFunction("append") { uri: String, headers: String? ->
            BBeBeeAudioEngine.nativeAppend(uri, headers)
        }

        // NaN means "keep the engine's own position" (a paused resume, or the
        // gapless re-bind where a seek back to zero would restart the track).
        AsyncFunction("playAt") { atMs: Double ->
            BBeBeeAudioEngine.nativePlayAt(atMs)
        }

        AsyncFunction("pause") { BBeBeeAudioEngine.nativePause() }
        AsyncFunction("stop") { BBeBeeAudioEngine.nativeStop() }

        AsyncFunction("seekMs") { ms: Double ->
            BBeBeeAudioEngine.nativeSeekMs(ms)
        }

        AsyncFunction("setVolume") { volume01: Double ->
            BBeBeeAudioEngine.nativeSetVolume(volume01)
        }

        AsyncFunction("setMuted") { muted: Boolean ->
            BBeBeeAudioEngine.nativeSetMuted(muted)
        }

        AsyncFunction("getState") { BBeBeeAudioEngine.nativeGetState() }
        AsyncFunction("engineStatus") { BBeBeeAudioEngine.nativeGetEngineStatus() }

        AsyncFunction("setVisualizer") { enabled: Boolean, fftSize: Int ->
            BBeBeeAudioEngine.nativeSetVisualizer(enabled, fftSize)
        }

        AsyncFunction("setDspConfig") { af: String, replaygain: String, clip: Boolean, preamp: String, fallback: String ->
            BBeBeeAudioEngine.nativeSetDspConfig(af, replaygain, clip, preamp, fallback)
        }

        AsyncFunction("setOutputDevice") { id: String ->
            BBeBeeAudioEngine.nativeSetOutputDevice(id)
        }

        // mpv's `audio-device-list` in Android vocabulary ({name, description}
        // rows, `auto` first) — what `core-audio-mpv`'s `listOutputDevices`
        // maps into OutputDevices. Enumeration only; route-change publishing
        // belongs to the shell (see AudioDevices.kt).
        AsyncFunction("mpvGetAudioDevices") {
            AudioDevices.listJson(appContext.reactContext)
        }

        AsyncFunction("setStreamPlayback") { playing: Boolean ->
            BBeBeeAudioEngine.nativeSetStreamPlayback(playing)
        }

        AsyncFunction("setAudioExclusive") { exclusive: Boolean ->
            BBeBeeAudioEngine.nativeSetAudioExclusive(exclusive)
        }

        AsyncFunction("getSpectrum") {
            val bins = BBeBeeAudioEngine.nativeGetFftBinCount()
            val freq = ByteArray(bins)
            val time = ByteArray(bins)
            val ok = BBeBeeAudioEngine.nativeGetSpectrum(freq, time)
            mapOf(
                "ok" to ok,
                // The JNI side transports the unsigned 0..255 bins in signed
                // bytes; widen before they cross into JS or every bin over
                // 127 arrives negative and the visualizer clips its top half.
                "frequencyData" to freq.map { it.toInt() and 0xFF },
                "timeDomainData" to time.map { it.toInt() and 0xFF },
            )
        }

        // ------------------------------------------------------------------
        // Codec seam (`bbebeeNativeCodec`): FFmpeg transcode + batch artwork.
        // ------------------------------------------------------------------

        AsyncFunction("transcode") { options: Map<String, Any?> ->
            NativeCodecBridge.transcode(
                appContext.reactContext,
                options["jobId"] as? String ?: "",
                options["inputUri"] as? String ?: "",
                options["outputUri"] as? String ?: "",
                options["format"] as? String ?: "mp3",
                options["bitrate"] as? String ?: "",
                (options["sampleRate"] as? Number)?.toInt() ?: 0,
                (options["channels"] as? Number)?.toInt() ?: 0,
                (options["startSeconds"] as? Number)?.toDouble() ?: 0.0,
                (options["endSeconds"] as? Number)?.toDouble() ?: 0.0,
                // The desktop ffmpeg options, forwarded for the native layer to
                // rule on (NativeCodecBridge reports what this engine build
                // cannot apply in the start answer's `unsupported` list).
                (options["bitDepth"] as? Number)?.toInt(),
                options["vbr"] as? Boolean,
                (options["vbrQuality"] as? Number)?.toDouble(),
                (options["volumeGainDb"] as? Number)?.toDouble(),
                (options["fadeInSeconds"] as? Number)?.toDouble(),
                (options["fadeOutSeconds"] as? Number)?.toDouble(),
            )
        }

        AsyncFunction("cancelTranscode") { jobId: String ->
            BBeBeeAudioEngine.nativeCancelTranscode(jobId)
        }

        AsyncFunction("getTranscodeState") { jobId: String ->
            BBeBeeAudioEngine.nativeGetTranscodeState(jobId)
        }

        AsyncFunction("getTranscodeCapabilities") {
            BBeBeeAudioEngine.nativeGetTranscodeCapabilities()
        }

        AsyncFunction("readArtworkBatch") { uris: List<String> ->
            NativeCodecBridge.readArtworkBatch(appContext.reactContext, uris)
        }
    }
}
