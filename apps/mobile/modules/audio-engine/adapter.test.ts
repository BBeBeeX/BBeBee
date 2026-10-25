/**
 * The pure adapter builders, against a scripted fake of the Expo module.
 *
 * These adapters are the seam between the JNI JSON payloads and the shapes
 * the engine probes — the degrade-on-not-ok rule for `mpvLoad`, the header
 * serialization mpv wants, the transcode parameter defaults. A lie here
 * reads as a working engine, which is why they are testable without `expo`
 * (see adapter.ts) and why the fake asserts the payload strings, not just
 * the return values.
 */

import { describe, expect, it } from 'vitest'

import {
  buildCodecAdapter,
  buildMpvAdapter,
  headersToFields,
  type NativeAudioEngine,
} from './adapter'

function fakeNative(overrides: Partial<NativeAudioEngine> = {}): NativeAudioEngine {
  return {
    loadEx: async () => JSON.stringify({ ok: true, durationMs: 1, resumed: false, endedCount: 0 }),
    append: async () => true,
    playAt: async () => {},
    pause: async () => {},
    stop: async () => {},
    seekMs: async () => {},
    setVolume: async () => {},
    setMuted: async () => {},
    getState: async () =>
      JSON.stringify({ positionMs: 0, durationMs: 0, status: 'idle', endedCount: 0 }),
    engineStatus: async () =>
      JSON.stringify({ running: true, mpvAvailable: true, pcmTapAvailable: true }),
    reinit: async () => true,
    setVisualizer: async () => {},
    setDspConfig: async () => {},
    setOutputDevice: async () => {},
    setStreamPlayback: async () => {},
    setAudioExclusive: async () => {},
    mpvGetAudioDevices: async () =>
      JSON.stringify([
        { name: 'auto', description: 'System default audio route' },
        { name: 'android/bt_a2dp', description: 'Pixel Buds (Bluetooth audio)' },
      ]),
    getSpectrum: async () => ({ ok: true, frequencyData: [0, 255], timeDomainData: [1, 254] }),
    transcode: async () => JSON.stringify({ ok: true, jobId: 'j1' }),
    cancelTranscode: async () => true,
    getTranscodeState: async () =>
      JSON.stringify({
        jobId: 'j1',
        found: true,
        running: false,
        done: true,
        ok: true,
        cancelled: false,
        progress: 1,
        currentTimeSec: 1,
        durationSec: 1,
      }),
    getTranscodeCapabilities: async () =>
      JSON.stringify({ supported: true, encoders: { libmp3lame: true } }),
    readArtworkBatch: async (uris) => uris.map(() => null),
    ...overrides,
  }
}

describe('headersToFields', () => {
  it("serializes mpv's http-header-fields shape and tolerates emptiness", () => {
    expect(headersToFields(undefined)).toBeNull()
    expect(headersToFields({})).toBeNull()
    expect(headersToFields({ Authorization: 'Bearer x', 'X-A': '1' })).toBe(
      'Authorization: Bearer x\r\nX-A: 1',
    )
  })
})

describe('buildMpvAdapter', () => {
  it('answers undefined on ok:false so the engine falls back, and parses through', async () => {
    const loadEx = async (uri: string) =>
      JSON.stringify(
        uri === 'bad'
          ? { ok: false, durationMs: 0, resumed: false, endedCount: 0 }
          : { ok: true, durationMs: 180000, resumed: true, endedCount: 2, sampleRate: 44100, channels: 2, bitDepth: 16 },
      )
    const mpv = buildMpvAdapter(fakeNative({ loadEx }))

    expect(await mpv.mpvLoad('bad')).toBeUndefined()
    const good = await mpv.mpvLoad('good')
    expect(good).toMatchObject({ durationMs: 180000, resumed: true, endedCount: 2 })
    // The hardware-rate fields the audio engine syncs on must survive the parse.
    expect(good).toMatchObject({ sampleRate: 44100, channels: 2, bitDepth: 16 })
  })

  it('sends NaN when no play position is given', async () => {
    const seen: number[] = []
    const mpv = buildMpvAdapter(fakeNative({ playAt: async (at) => void seen.push(at) }))
    await mpv.mpvPlay()
    await mpv.mpvPlay(1500)
    expect(seen[0]).toBeNaN()
    expect(seen[1]).toBe(1500)
  })

  it('maps null FFT frames, not empty ones', async () => {
    const mpv = buildMpvAdapter(
      fakeNative({ getSpectrum: async () => ({ ok: false, frequencyData: [], timeDomainData: [] }) }),
    )
    expect(await mpv.mpvGetFftFrame()).toBeNull()
    const frame = await buildMpvAdapter(fakeNative()).mpvGetFftFrame()
    expect(frame).toEqual({ frequencyData: [0, 255], timeDomainData: [1, 254] })
  })

  it('defaults the DSP config fields the JNI side expects', async () => {
    const seen: unknown[][] = []
    const mpv = buildMpvAdapter(fakeNative({ setDspConfig: async (...args) => void seen.push(args) }))
    await mpv.mpvSetDspConfig({ af: 'volume=2' })
    expect(seen[0]).toEqual(['volume=2', 'no', false, '0', '0'])
  })

  it('surfaces the reinit answer so the service can log a refused recovery', async () => {
    // The engine-wedge recovery: the adapter only relays the native answer;
    // whether the new engine came up decides the service's warning.
    const mpv = buildMpvAdapter(fakeNative({ reinit: async () => false }))
    expect(await mpv.mpvReinit()).toBe(false)
  })

  it('parses the mpv-shaped device list the shared engine maps into OutputDevices', async () => {
    /*
     * `core-audio-mpv`'s `listOutputDevices` calls `mpvGetAudioDevices` on the
     * bridge and maps `{ name, description }` rows — `auto`/`default` flagged
     * as the default — into `OutputDevice`s. The adapter's whole job is the
     * JSON parse; the shape assertion is what stops a field rename here from
     * quietly falling back to the one synthesized "default" device.
     */
    const mpv = buildMpvAdapter(fakeNative())
    const devices = await mpv.mpvGetAudioDevices()
    expect(devices).toHaveLength(2)
    expect(devices[0]).toEqual({ name: 'auto', description: 'System default audio route' })
    expect(devices[1]).toMatchObject({ name: 'android/bt_a2dp' })
    expect(devices[1]!.description).toContain('Bluetooth audio')
  })
})

describe('buildCodecAdapter', () => {
  it('short-circuits empty artwork batches without crossing the bridge', async () => {
    let calls = 0
    const codec = buildCodecAdapter(
      fakeNative({
        readArtworkBatch: async (uris) => {
          calls += uris.length
          return uris.map(() => null)
        },
      }),
    )
    expect(await codec.readArtworkBatch([])).toEqual([])
    expect(calls).toBe(0)
  })

  it("passes transcode options with native defaults for absent fields", async () => {
    const seen: unknown[] = []
    const codec = buildCodecAdapter(
      fakeNative({
        transcode: async (options) => {
          seen.push(options)
          return JSON.stringify({ ok: true, jobId: "j9" })
        },
      }),
    )
    const answer = await codec.transcode({ inputUri: "a", outputUri: "b", format: "flac" })
    expect(answer).toEqual({ ok: true, jobId: "j9" })
    // The record crosses as-is: defaulting to the C++ side's conventions
    // happens in the native module, not twice.
    expect(seen[0]).toEqual({ inputUri: "a", outputUri: "b", format: "flac" })
  })

  it('forwards the desktop-only transcode options and the unsupported report', async () => {
    const seen: Record<string, unknown>[] = []
    const codec = buildCodecAdapter(
      fakeNative({
        transcode: async (options) => {
          seen.push(options as unknown as Record<string, unknown>)
          return JSON.stringify({
            ok: true,
            jobId: 'j10',
            unsupported: ['volumeGainDb', 'fadeInSeconds'],
          })
        },
      }),
    )
    const answer = await codec.transcode({
      inputUri: 'a',
      outputUri: 'b',
      format: 'mp3',
      bitDepth: 24,
      vbr: true,
      vbrQuality: 2,
      volumeGainDb: -3,
      fadeInSeconds: 0.5,
      fadeOutSeconds: 1,
    })
    // The record crosses verbatim — the native layer rules on it, not the
    // adapter — and the engine's `unsupported` ruling survives the parse.
    expect(seen[0]).toMatchObject({
      bitDepth: 24,
      vbr: true,
      vbrQuality: 2,
      volumeGainDb: -3,
      fadeInSeconds: 0.5,
      fadeOutSeconds: 1,
    })
    expect(answer.unsupported).toEqual(['volumeGainDb', 'fadeInSeconds'])
  })

  it('parses transcode state and capabilities verbatim', async () => {
    const codec = buildCodecAdapter(fakeNative())
    expect(await codec.getTranscodeState('j1')).toMatchObject({ done: true, ok: true, found: true })
    expect(await codec.getTranscodeCapabilities()).toEqual({
      supported: true,
      encoders: { libmp3lame: true },
    })
  })
})
