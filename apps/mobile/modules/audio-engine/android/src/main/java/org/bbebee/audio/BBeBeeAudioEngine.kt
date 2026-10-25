package org.bbebee.audio

/**
 * The Java-side loader for `libbbebee_audio_jni.so` — the library the Expo
 * config plugin (`apps/mobile/plugins/with-audio-engine.js`) stages into
 * `jniLibs/<abi>/` from the audio-engine release artifacts.
 *
 * Every `external fun` maps 1:1 to a `Java_org_bbebee_audio_BBeBeeAudioEngine_native*`
 * export in `engine/jni/bbebee_audio_jni.cpp` (B_Be_Bee-audio-engine); the
 * signatures there are the authority. Nothing but [BbebeeAudioEngineModule]
 * may call these.
 */
object BBeBeeAudioEngine {
    init {
        System.loadLibrary("bbebee_audio_jni")
    }

    external fun nativeInit(configDir: String?): Boolean
    external fun nativeDestroy()
    external fun nativeLoad(uri: String): Boolean
    external fun nativeLoadEx(uri: String, headers: String?): String
    external fun nativeAppend(uri: String, headers: String?): Boolean
    external fun nativePlay()
    external fun nativePlayAt(atMs: Double)
    external fun nativePause()
    external fun nativeStop()
    external fun nativeSeekMs(ms: Double)
    external fun nativeSetVolume(volume01: Double)
    external fun nativeSetMuted(muted: Boolean)
    external fun nativeSetDspConfig(
        af: String,
        replaygain: String,
        replaygainClip: Boolean,
        replaygainPreamp: String,
        replaygainFallback: String,
    )
    external fun nativeSetVisualizer(enabled: Boolean, fftSize: Int)
    external fun nativeSetOutputDevice(device: String)
    external fun nativeSetStreamPlayback(playing: Boolean)
    external fun nativeSetAudioExclusive(exclusive: Boolean)
    external fun nativeGetSpectrum(outFreq: ByteArray, outTime: ByteArray): Boolean
    external fun nativeGetRingBufferStats(): LongArray
    external fun nativeGetState(): String
    external fun nativeGetFftBinCount(): Int
    external fun nativeGetEngineStatus(): String

    // Transcoder exports (codec seam, not the mpv playback contract). Paths
    // reach the C++ layer; `content://` style URIs must be resolved to real
    // filesystem paths by [NativeCodecBridge] first.
    external fun nativeTranscode(
        jobId: String,
        inputPath: String,
        outputPath: String,
        format: String,
        bitrate: String,
        sampleRate: Int,
        channels: Int,
        startSec: Double,
        endSec: Double,
    ): String
    external fun nativeCancelTranscode(jobId: String): Boolean
    external fun nativeGetTranscodeState(jobId: String): String
    external fun nativeGetTranscodeCapabilities(): String
}
