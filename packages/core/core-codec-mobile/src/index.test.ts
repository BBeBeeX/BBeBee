/**
 * The native-seam overrides, against a fake `bbebeeNativeCodec`.
 *
 * The real seam lives behind a JNI library no CI host can load, so the fake
 * reproduces the JSON contract the Expo module speaks: positional base64
 * answers with `null` per miss, a transcode job registry polled through
 * `getTranscodeState`, and an encoder capability probe. What the tests buy
 * is exactly the part that must not drift: the positional contract, the
 * fallback when the seam is absent or lies, abort wiring, and the capability
 * derivation the converter UI renders.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { FsService, Uri } from '@BBeBee/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import plugin, { type CodecRn } from './index.js'
import { encodeBase64 } from '@BBeBee/toolkit'

/* ── the fake seam ──────────────────────────────────────────────────────── */

type TranscodeState = {
  found: boolean
  running: boolean
  done: boolean
  ok: boolean
  cancelled: boolean
  progress: number
  currentTimeSec: number
  durationSec: number
  error?: string
}

function fakeSeam(overrides: Partial<NativeCodecFake> = {}) {
  const calls = {
    transcode: [] as Array<{ jobId: string; inputUri: string; outputUri: string; format: string }>,
    cancel: [] as string[],
  }
  let state: TranscodeState = {
    found: true,
    running: false,
    done: true,
    ok: true,
    cancelled: false,
    progress: 1,
    currentTimeSec: 0,
    durationSec: 0,
  }
  const seam: NativeCodecFake = {
    readArtworkBatch: async (uris: string[]) => uris.map(() => encodeBase64(new Uint8Array([1, 2, 3]))),
    transcode: async (options) => {
      calls.transcode.push({
        jobId: options.jobId ?? '',
        inputUri: options.inputUri,
        outputUri: options.outputUri,
        format: options.format,
      })
      return { ok: true, jobId: options.jobId ?? 'job-1' }
    },
    cancelTranscode: async (jobId: string) => {
      calls.cancel.push(jobId)
      return true
    },
    getTranscodeState: async () => state,
    getTranscodeCapabilities: async () => ({ supported: true, encoders: {} }),
    ...overrides,
  }
  return { seam, calls, setState: (next: TranscodeState) => (state = next) }
}

type NativeCodecFake = {
  readArtworkBatch(uris: string[]): Promise<Array<string | null>>
  transcode(options: {
    jobId?: string
    inputUri: string
    outputUri: string
    format: string
    bitrate?: string
    sampleRate?: number
    channels?: number
    startSeconds?: number
    endSeconds?: number
  }): Promise<{ ok: boolean; jobId?: string; error?: string }>
  cancelTranscode(jobId: string): Promise<boolean>
  getTranscodeState(jobId: string): Promise<TranscodeState>
  getTranscodeCapabilities(): Promise<{ supported: boolean; encoders: Record<string, boolean> }>
}

/* ── harness ────────────────────────────────────────────────────────────── */

async function harness() {
  const dir = await tempDir('bbebee-codec-rn-test')
  const ctx = new Context()
  /*
   * Warnings are captured through cordis's exporter API: the codec service's
   * scoped context logs through the root LoggerService, and an exporter sits
   * under every `logger.warn` call regardless of which context makes it. A
   * `vi.spyOn` on one context's shadow method would never see another
   * context's call.
   */
  const warns: string[] = []
  ctx.logger.exporter({
    export(message) {
      if (message.type === 'warn') warns.push(message.args.map(String).join(' '))
    },
  })
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-codec-rn-app') })
  await ctx.plugin(FsNode)
  await tick()

  const scoped = ctx.isolate('codec')
  await scoped.plugin(plugin, {})
  await tick()

  return {
    ctx,
    codec: scoped.codec as CodecRn,
    fs: ctx.fs as FsService,
    warns,
    dir,
    uri: (name: string): Uri => pathToFileURL(join(dir, name)).href as Uri,
  }
}

const globals = globalThis as { bbebeeNativeCodec?: unknown }
const savedSeam = globals.bbebeeNativeCodec

beforeEach(() => {
  delete globals.bbebeeNativeCodec
})

afterEach(() => {
  if (savedSeam === undefined) delete globals.bbebeeNativeCodec
  else globals.bbebeeNativeCodec = savedSeam
})

/* ── tests ──────────────────────────────────────────────────────────────── */

describe('core-codec-mobile native seam', () => {
  it('decodes the native artwork batch positionally, nulls to undefined', async () => {
    const h = await harness()
    const { seam } = fakeSeam({
      readArtworkBatch: async (uris: string[]) =>
        uris.map((u, i) => (i === 1 ? null : encodeBase64(new Uint8Array([i, i + 1])))),
    })
    globals.bbebeeNativeCodec = seam

    const results = await h.codec.readArtworkBatch(['content://a', 'content://b', 'content://c'] as Uri[])

    expect(results).toHaveLength(3)
    expect(Array.from(results[0]!)).toEqual([0, 1])
    expect(results[1]).toBeUndefined()
    expect(Array.from(results[2]!)).toEqual([2, 3])
  })

  it('falls back to the in-process batch when the seam rejects', async () => {
    const h = await harness()
    const { seam } = fakeSeam({
      readArtworkBatch: async () => {
        throw new Error('bridge died')
      },
    })
    globals.bbebeeNativeCodec = seam

    // Unreadable URIs: the fallback answers positional undefined, never rejects.
    const results = await h.codec.readArtworkBatch(['content://a', 'content://b'] as Uri[])
    expect(results).toEqual([undefined, undefined])
  })

  it('falls back when the seam lies about the positional contract', async () => {
    const h = await harness()
    const { seam } = fakeSeam({
      readArtworkBatch: async (uris: string[]) => uris.slice(0, 1).map(() => encodeBase64(new Uint8Array([9]))),
    })
    globals.bbebeeNativeCodec = seam

    const results = await h.codec.readArtworkBatch(['content://a', 'content://b'] as Uri[])
    expect(results).toHaveLength(2)
    expect(results[0]).toBeUndefined()
    expect(results[1]).toBeUndefined()
  })

  it('keeps working with no seam at all', async () => {
    const h = await harness()
    const results = await h.codec.readArtworkBatch(['content://a'] as Uri[])
    expect(results).toEqual([undefined])
  })

  it('transcodes through the native job and reports the output size', async () => {
    const h = await harness()
    const output = join(h.dir, 'out.mp3')
    await writeFile(output, 'fake audio bytes')
    const { seam, calls } = fakeSeam()
    globals.bbebeeNativeCodec = seam

    const result = await h.codec.transcode({
      inputUri: h.uri('in.flac'),
      outputUri: pathToFileURL(output).href as Uri,
      targetFormat: 'mp3',
      bitrate: '192k',
    })

    expect(result.ok).toBe(true)
    expect(result.outputSize).toBe('fake audio bytes'.length)
    expect(calls.transcode[0]!.format).toBe('mp3')
    expect(calls.transcode[0]!.inputUri).toContain('in.flac')
  })

  it('streams progress while the job runs and lands on the final answer', async () => {
    const h = await harness()
    const output = join(h.dir, 'out2.mp3')
    await writeFile(output, 'x')
    const { seam, setState } = fakeSeam()
    setState({
      found: true,
      running: true,
      done: false,
      ok: false,
      cancelled: false,
      progress: 0.5,
      currentTimeSec: 30,
      durationSec: 60,
    })
    globals.bbebeeNativeCodec = seam

    const progress: Array<[number, number]> = []
    const done = h.codec.transcode({
      inputUri: h.uri('in.flac'),
      outputUri: pathToFileURL(output).href as Uri,
      targetFormat: 'mp3',
      onProgress: (pct, sec) => progress.push([pct, sec]),
    })

    // Let the first poll fire, then settle the job; the poller picks the
    // terminal state up on its next iteration.
    await new Promise((resolve) => setTimeout(resolve, 320))
    setState({
      found: true,
      running: false,
      done: true,
      ok: true,
      cancelled: false,
      progress: 1,
      currentTimeSec: 60,
      durationSec: 60,
    })

    const result = await done
    expect(result.ok).toBe(true)
    expect(progress.length).toBeGreaterThanOrEqual(1)
    expect(progress[0]![0]).toBe(0.5)
    expect(progress[0]![1]).toBe(30)
  })

  it('cancels through the seam when the caller aborts', async () => {
    const h = await harness()
    const output = join(h.dir, 'out3.mp3')
    await writeFile(output, 'x')
    const { seam, calls, setState } = fakeSeam()
    setState({
      found: true,
      running: true,
      done: false,
      ok: false,
      cancelled: false,
      progress: 0.1,
      currentTimeSec: 5,
      durationSec: 60,
    })
    globals.bbebeeNativeCodec = seam

    const controller = new AbortController()
    const done = h.codec.transcode({
      inputUri: h.uri('in.flac'),
      outputUri: pathToFileURL(output).href as Uri,
      targetFormat: 'mp3',
      signal: controller.signal,
    })

    await new Promise((resolve) => setTimeout(resolve, 320))
    controller.abort()

    setState({
      found: true,
      running: false,
      done: true,
      ok: false,
      cancelled: true,
      progress: 0.1,
      currentTimeSec: 5,
      durationSec: 60,
    })

    const result = await done
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Cancelled')
    // The abort listener fires once; the poll loop may nudge again on its
    // next tick — both routes must reach the same job id.
    expect(calls.cancel.length).toBeGreaterThanOrEqual(1)
    expect(calls.cancel[0]).toBe(calls.transcode[0]!.jobId)
  })

  it('refuses honestly when the native build has no FFmpeg', async () => {
    const h = await harness()
    const { seam, calls } = fakeSeam({
      getTranscodeCapabilities: async () => ({ supported: false, encoders: {} }),
    })
    globals.bbebeeNativeCodec = seam

    const result = await h.codec.transcode({
      inputUri: h.uri('in.flac'),
      outputUri: h.uri('out.mp3'),
      targetFormat: 'mp3',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('no FFmpeg')
    expect(calls.transcode).toHaveLength(0)
  })

  it('announces the dropped fields once when the native path cannot honour them', async () => {
    const h = await harness()
    const output = join(h.dir, 'out-dropped.mp3')
    await writeFile(output, 'x')
    const { seam, calls } = fakeSeam()
    globals.bbebeeNativeCodec = seam

    const result = await h.codec.transcode({
      inputUri: h.uri('in.flac'),
      outputUri: pathToFileURL(output).href as Uri,
      targetFormat: 'mp3',
      bitrate: '192k',
      bitDepth: 24,
      vbr: true,
      vbrQuality: 2,
      volumeGainDb: -3,
      fadeInSeconds: 0.5,
      fadeOutSeconds: 1,
    })

    // The job still runs (engine-path parity is deliberate); the warning is
    // what turns a silently CBR, gain-free, fade-free output into a spoken one.
    expect(result.ok).toBe(true)
    expect(calls.transcode).toHaveLength(1)
    expect(h.warns).toHaveLength(1)
    for (const field of ['bitDepth', 'vbr', 'vbrQuality', 'volumeGainDb', 'fadeInSeconds', 'fadeOutSeconds']) {
      expect(h.warns[0]).toContain(field)
    }
  })

  it('does not warn when only the engine-supported subset is sent', async () => {
    const h = await harness()
    const output = join(h.dir, 'out-supported.mp3')
    await writeFile(output, 'x')
    const { seam } = fakeSeam()
    globals.bbebeeNativeCodec = seam

    const result = await h.codec.transcode({
      inputUri: h.uri('in.flac'),
      outputUri: pathToFileURL(output).href as Uri,
      targetFormat: 'mp3',
      bitrate: '192k',
      sampleRate: 44100,
      channels: 2,
      startTimeSeconds: 1,
      endTimeSeconds: 10,
    })

    expect(result.ok).toBe(true)
    expect(h.warns).toHaveLength(0)
  })

  it('derives encoder capabilities from the native probe over the shared vocabulary', async () => {
    const h = await harness()
    const { seam } = fakeSeam({
      getTranscodeCapabilities: async () => ({
        supported: true,
        encoders: { libmp3lame: true, flac: false, aac: true, libopus: true, libvorbis: true, pcm_s16le: true },
      }),
    })
    globals.bbebeeNativeCodec = seam

    const caps = await h.codec.getEncoderCapabilities()

    expect(caps.encoders.libmp3lame!.available).toBe(true)
    expect(caps.encoders.flac!.available).toBe(false)
    expect(caps.encoders.flac!.name).toBe('FLAC')
    // aac unlocks m4a; opus unlocks webm; pcm_s16le unlocks pcm — the same
    // derivation the desktop capability code applies.
    expect(caps.supportedOutputFormats).toEqual(
      expect.arrayContaining(['mp3', 'aac', 'm4a', 'opus', 'webm', 'ogg', 'wav', 'pcm']),
    )
    expect(caps.supportedOutputFormats).not.toContain('flac')
    expect(caps.supportedInputFormats).toContain('ape')
  })

  it('falls back to the inherited capability probe without a seam', async () => {
    const h = await harness()
    const caps = await h.codec.getEncoderCapabilities()
    // No local ffmpeg and no native engine on RN: the inherited honesty rule
    // reports every encoder unavailable rather than promising.
    for (const encoder of Object.values(caps.encoders)) {
      expect(encoder.available).toBe(false)
    }
  })
})
