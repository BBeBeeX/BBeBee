/**
 * The JS half of the native audio-engine binding (`libbbebee_audio_jni.so`).
 *
 * Installs two seams that downstream code probes:
 *
 * - `globalThis.bbebeeMobileMpv` — the playback adapter (`buildMpvAdapter`),
 *   the seam `createMobileMpvBridge` in `apps/mobile/src/mobile-audio.ts`
 *   probes. The method surface is the contract table in
 *   `docs/audio/engine.md`; nothing here may drift from it, or the engine's
 *   probes start lying.
 * - `globalThis.bbebeeNativeCodec` — the codec adapter (`buildCodecAdapter`),
 *   the seam `CodecRn` probes for batch artwork extraction and FFmpeg
 *   transcoding through the same JNI library.
 *
 * ⚠️ Loaded for its side effect from `boot.ts` and nowhere else: a build
 * without the native module (a dev client predating it, a JS-only run) must
 * fall back to the in-process simulation bridge rather than crash, so the
 * probe lives in one guarded place that runs before the audio service mounts.
 * It deliberately does NOT live in `mobile-audio.ts`, which unit tests import
 * without an Expo runtime. The adapter builders themselves live in
 * `adapter.ts` (no `expo` import) so tests can exercise them directly.
 */

import { requireNativeModule } from 'expo'

import {
  buildCodecAdapter,
  buildMpvAdapter,
  type NativeAudioEngine,
} from './adapter'

function install(): void {
  const globals = globalThis as { bbebeeMobileMpv?: unknown; bbebeeNativeCodec?: unknown }
  if (globals.bbebeeMobileMpv) return

  let native: NativeAudioEngine
  try {
    native = requireNativeModule<NativeAudioEngine>('BbebeeAudioEngine')
  } catch {
    // No native module in this build — the simulation bridge takes over.
    return
  }

  globals.bbebeeMobileMpv = buildMpvAdapter(native)
  globals.bbebeeNativeCodec = buildCodecAdapter(native)
}

install()
