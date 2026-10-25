#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The iOS mpv engine core — the ObjC++ twin of the Android
 * `libbbebee_audio_jni.so` JNI surface (`engine/jni/bbebee_audio_jni.cpp` in
 * B_Be_Bee-audio-engine).
 *
 * It owns the one mpv handle for the process, drives it from a dedicated
 * event-pump thread, and taps real PCM through the custom libmpv export
 * `mpv_set_pcm_callback` (see `resources/ios/mpv.framework/Headers/client.h`
 * — post-DSP, post-volume, interleaved float32, invoked on the audio playback
 * thread) into a lock-free SPSC ring buffer that feeds a Radix-2
 * Cooley–Tukey FFT for the visualizer seam. Audio output itself stays inside
 * mpv (`ao=audiounit`, the only audio output compiled into the bundled
 * framework); the tap is passive observation, never a second output path.
 *
 * The JSON answers mirror the Android JNI contracts byte-for-byte (the
 * payload authority is `docs/audio/engine.md` — the mobile binding contract
 * table) so the JS adapter (`modules/audio-engine/adapter.ts`) parses this
 * platform's answers with the same code it uses on Android.
 *
 * Threading: every method is designed to be called from ONE thread at a time
 * (the Expo module serializes all calls onto its own dispatch queue — the
 * equivalent of Android's dedicated module thread). The exceptions are
 * `stateJson` / `engineStatusJson`, which only read atomics plus thread-safe
 * mpv property reads.
 *
 * When the prebuilt `mpv.framework` was not on the framework search path at
 * build time (`__has_include(<mpv/client.h>)` fails), the whole core
 * degrades to a stub: `boot` fails, `engineStatusJson` reports
 * `running:false, mpvAvailable:false, pcmTapAvailable:false` and every
 * playback call answers its no-op value — the same "libmpv symbols
 * unavailable" stub mode the prebuilt `BBeBeeAudioBridge` carries, and the
 * shape the JS layer already treats as the simulation fallback.
 */
@interface BbebeeMpvCore : NSObject

/// Create, configure and initialize the mpv context and start the event pump.
/// Idempotent per instance: returns YES immediately when already booted.
- (BOOL)boot:(NSError * _Nullable * _Nullable)error;

/// Unregister the PCM tap, stop the event pump and destroy the mpv context.
/// Safe to call repeatedly; `boot` may follow on the same instance.
- (void)shutdown;

@property (nonatomic, readonly, getter=isBooted) BOOL booted;

#pragma mark - Playback contract (JSON answers, Android JNI parity)

/// The `loadEx` answer — `{ok, durationMs, resumed, endedCount[, sampleRate,
/// channels, bitDepth]}` as a JSON string. Implements the gapless re-bind
/// detection from `docs/audio/engine.md` §"Gapless Handoff": a request for the
/// URI mpv is already sounding answers `resumed:true` and touches nothing.
- (NSString *)loadEx:(NSString *)uri headers:(nullable NSString *)headers;

/// Gapless playlist append (`loadfile <uri> append`). NO on command failure.
- (BOOL)appendUri:(NSString *)uri headers:(nullable NSString *)headers;

/// `play` — seek to `atMs` first when finite and non-negative; NaN is the
/// adapter's "keep the engine's own position" marker (a paused resume, or the
/// gapless re-bind where a seek back to zero would restart the track).
- (void)playAtMs:(double)atMs;

- (void)pausePlayback;
- (void)stopPlayback;
- (void)seekToMs:(double)ms;
/// `volume` 0..1 → mpv's 0..100 percent scale.
- (void)setVolume01:(double)volume01;
- (void)setMuted:(BOOL)muted;

/// `{positionMs, durationMs, status: 'idle'|'playing'|'paused'|'ended'|'error',
/// endedCount}`. `error` = idle-after-a-taken-load with no user stop (the
/// polling model's reading of a mid-track mpv failure).
- (NSString *)stateJson;

/// `{running, mpvAvailable, pcmTapAvailable, transcodeAvailable}`.
- (NSString *)engineStatusJson;

- (void)setDspConfigAf:(NSString *)af
            replaygain:(NSString *)replaygain
                  clip:(BOOL)clip
                preamp:(NSString *)preamp
              fallback:(NSString *)fallback;

/// Only `auto`/`default` are forwarded to mpv's `audio-device` property; on
/// iOS the OS owns output routing (AVAudioSession has no per-app sink choice),
/// so any other engine-vocabulary id is remembered and logged, never pushed —
/// an unknown `audio-device` would make the audiounit ao fail to reopen.
- (void)setOutputDeviceId:(NSString *)deviceId;

/// Keeps the visualizer loop in its playing branch while a track degrades to
/// the media element (desktop `setStreamPlayback` semantics: frames keep
/// flowing, decaying toward silence, since no PCM ever arrives).
- (void)setStreamPlayback:(BOOL)playing;

- (void)setAudioExclusive:(BOOL)exclusive;

/// Register/unregister the PCM tap and size the FFT. `fftSize` 0 = default.
/// Returns whether the tap is registered after the call.
- (BOOL)setVisualizer:(BOOL)enabled fftSize:(NSUInteger)fftSize;

#pragma mark - Visualizer seam (unsigned 0..255 bins, Kotlin-module parity)

/// Number of bins `getSpectrum…` writes into each out buffer (0 = tap off).
- (NSUInteger)fftBinCount;

/// Fill `frequency` and `timeDomain` (each `count` bytes, 0..255) with the
/// latest frame; NO when the tap is off or nothing has been sounding. The
/// Kotlin module widens its signed-JNI bytes the same way this core writes
/// them: already unsigned here, so no widening is needed.
- (BOOL)getSpectrumFrequencyOut:(uint8_t *)frequency
                 timeDomainOut:(uint8_t *)timeDomain
                         count:(NSUInteger)count;

@end

NS_ASSUME_NONNULL_END
