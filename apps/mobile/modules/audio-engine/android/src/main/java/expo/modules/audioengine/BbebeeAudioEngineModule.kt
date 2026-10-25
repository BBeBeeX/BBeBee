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
                "frequencyData" to freq.toList(),
                "timeDomainData" to time.toList(),
            )
        }
    }
}
