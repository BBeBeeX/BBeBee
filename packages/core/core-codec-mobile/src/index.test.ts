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

import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { codecConformance } from '@BBeBee/protocol/conformance'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { FsService, Uri } from '@BBeBee/protocol'
import { DEFAULT_FORMATS } from '@bbebee/core-codec-desktop'
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

type TranscodeCallOptions = {
  jobId?: string
  inputUri: string
  outputUri: string
  format: string
  bitrate?: string
  sampleRate?: number
  channels?: number
  startSeconds?: number
  endSeconds?: number
  bitDepth?: number
  vbr?: boolean
  vbrQuality?: number
  volumeGainDb?: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
}

function fakeSeam(overrides: Partial<NativeCodecFake> = {}) {
  const calls = {
    transcode: [] as TranscodeCallOptions[],
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
      calls.transcode.push({ ...options })
      /*
       * The pinned engine build cannot apply the desktop-only options, and —
       * exactly like the real `NativeCodecBridge` — reports them in the start
       * answer's `unsupported` list. That report is the one truth the JS side
       * warns from; a fake that dropped them silently would let the adapter
       * regress to guessing.
       */
      const unsupported = [
        ...(options.bitDepth != null ? ['bitDepth'] : []),
        ...(options.vbr === true && options.vbrQuality != null ? ['vbr', 'vbrQuality'] : []),
        ...(options.volumeGainDb != null ? ['volumeGainDb'] : []),
        ...(options.fadeInSeconds != null ? ['fadeInSeconds'] : []),
        ...(options.fadeOutSeconds != null ? ['fadeOutSeconds'] : []),
      ]
      return {
        ok: true,
        jobId: options.jobId ?? 'job-1',
        ...(unsupported.length > 0 ? { unsupported } : {}),
      }
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
  transcode(options: TranscodeCallOptions): Promise<{
    ok: boolean
    jobId?: string
    error?: string
    unsupported?: string[]
  }>
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

  it('forwards the desktop-only transcode options to the seam verbatim', async () => {
    const h = await harness()
    const output = join(h.dir, 'out-extended.mp3')
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

    // Pass-through, not a drop: every field reaches the native layer, which
    // is the only side entitled to rule on what the linked build supports.
    expect(result.ok).toBe(true)
    expect(calls.transcode).toHaveLength(1)
    expect(calls.transcode[0]).toMatchObject({
      bitDepth: 24,
      vbr: true,
      vbrQuality: 2,
      volumeGainDb: -3,
      fadeInSeconds: 0.5,
      fadeOutSeconds: 1,
    })
  })

  it('warns once, naming the fields the engine itself reports unsupported', async () => {
    const h = await harness()
    const output = join(h.dir, 'out-unsupported.mp3')
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

    // The job still runs (the fields are forwarded, not refused); the warning
    // is the engine's own ruling echoed once, so a silently CBR, gain-free,
    // fade-free output is a spoken one.
    expect(result.ok).toBe(true)
    expect(calls.transcode).toHaveLength(1)
    expect(h.warns).toHaveLength(1)
    for (const field of ['bitDepth', 'vbr', 'vbrQuality', 'volumeGainDb', 'fadeInSeconds', 'fadeOutSeconds']) {
      expect(h.warns[0]).toContain(field)
    }
  })

  it('does not warn when the engine reports nothing unsupported', async () => {
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

  it('declares the bundled libmpv engine list, mirroring the desktop default', async () => {
    const h = await harness()
    // The phone runs the same bundled libmpv build the desktop native engine
    // runs, so the declared decode capability is the desktop engine's list —
    // not the old hand-picked six, which sent ogg/opus/dsd tracks to the
    // import-error path files did not deserve.
    expect(h.codec.supportedFormats()).toEqual([...DEFAULT_FORMATS])
    expect(h.codec.supportedFormats()).toContain('ogg')
    expect(h.codec.supportedFormats()).toContain('dsf')
  })

  it('honours a shell-configured narrower list', async () => {
    // A build that knows it shipped without the engine may narrow the list.
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-codec-rn-app') })
    await ctx.plugin(FsNode)
    await tick()
    const scoped = ctx.isolate('codec')
    await scoped.plugin(plugin, { supportedFormats: ['mp3', 'flac'] })
    await tick()
    expect((scoped.codec as CodecRn).supportedFormats()).toEqual(['mp3', 'flac'])
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
    // The probe is pinned to an empty stdout — a host with ffmpeg on PATH
    // (like this one) would otherwise answer from a real spawn and the
    // honesty rule under test would never be reached.
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-codec-rn-app') })
    await ctx.plugin(FsNode)
    await tick()
    const scoped = ctx.isolate('codec')
    await scoped.plugin(plugin, { probeEncoders: async () => '' })
    await tick()
    const caps = await (scoped.codec as CodecRn).getEncoderCapabilities()
    // No local ffmpeg and no native engine on RN: the inherited honesty rule
    // reports every encoder unavailable rather than promising.
    for (const encoder of Object.values(caps.encoders)) {
      expect(encoder.available).toBe(false)
    }
  })
})

/* ── the shared codec conformance suite ─────────────────────────────────── */

/**
 * The same fixtures the desktop twin builds, byte by byte, so the shared
 * checks mean the same thing on both sides. `CodecRn` inherits its tag reading
 * from `CodecNode` (music-metadata over `ctx.fs`), and the suite runs with the
 * seam absent — the `beforeEach` above has removed it — which is the honest
 * floor: the inherited path must be right before the native overrides are.
 */

function textFrame(id: string, value: string): Uint8Array {
  const body = new Uint8Array([0x03, ...new TextEncoder().encode(value)]) // 0x03 = UTF-8
  return frame(id, body)
}

function pictureFrame(bytes: Uint8Array): Uint8Array {
  const body = new Uint8Array([
    0x00, // ISO-8859-1
    ...new TextEncoder().encode('image/jpeg'),
    0x00,
    0x03, // cover (front)
    0x00, // empty description
    ...bytes,
  ])
  return frame('APIC', body)
}

function frame(id: string, body: Uint8Array): Uint8Array {
  const size = body.length
  return new Uint8Array([
    ...new TextEncoder().encode(id),
    (size >> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    0x00,
    0x00,
    ...body,
  ])
}

/** An ID3v2.3 tag followed by `paddingBytes` of (meaningless) audio. */
function taggedMp3(frames: Uint8Array[], paddingBytes: number): Uint8Array {
  const body = frames.reduce<number[]>((all, f) => [...all, ...f], [])
  const size = body.length
  // The tag length is stored syncsafe: seven bits per byte.
  const header = [
    ...new TextEncoder().encode('ID3'),
    0x03,
    0x00,
    0x00,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]
  // A minimal MPEG-1 Layer III frame header, then silence. Enough for the
  // parser to agree the file is an MP3.
  const audio = new Uint8Array(paddingBytes)
  audio.set([0xff, 0xfb, 0x90, 0x00], 0)
  return new Uint8Array([...header, ...body, ...audio])
}

const SAMPLE = {
  title: 'Jóga',
  artist: 'Björk',
  album: 'Homogenic',
  trackNo: 2,
  year: 1997,
}

/**
 * `ctx.fs`, counting the bytes actually pulled — the desktop twin's counter,
 * so the byte-ceiling check is measured the same way on both sides.
 */
function countingFs(real: FsService, counter: { bytes: number }) {
  class CountingFs extends Service {
    constructor(ctx: Context) {
      super(ctx, 'fs')
    }
    async readRange(uri: Uri, start: number, end: number) {
      const bytes = await real.readRange(uri, start, end)
      counter.bytes += bytes.byteLength
      return bytes
    }
    createReadStream(uri: Uri, range?: { start: number; end?: number }) {
      const source = real.createReadStream(uri, range)
      return source.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            counter.bytes += chunk.byteLength
            controller.enqueue(chunk)
          },
        }),
      )
    }
  }
  for (const key of [
    'dir',
    'join',
    'basename',
    'extname',
    'exists',
    'stat',
    'list',
    'mkdir',
    'remove',
    'move',
    'copy',
    'readFile',
    'readBytes',
    'writeFile',
    'createWriteStream',
    'freeSpace',
    'watch',
    'pickDirectory',
    'pickFiles',
    'toPlayableUri',
  ] as const) {
    Object.defineProperty(CountingFs.prototype, key, {
      value: (...args: unknown[]) => (real[key] as (...a: unknown[]) => unknown)(...args),
    })
  }
  Object.defineProperty(CountingFs.prototype, 'canWatch', { get: () => real.canWatch })
  return CountingFs
}

async function conformanceHarness() {
  const dir = await tempDir('bbebee-codec-rn-conformance')
  const uri = (name: string) => pathToFileURL(join(dir, name)).href

  // 5 MB of padding, so "did it read the whole file" is a real question.
  const withArt = taggedMp3(
    [
      textFrame('TIT2', SAMPLE.title),
      textFrame('TPE1', SAMPLE.artist),
      textFrame('TALB', SAMPLE.album),
      textFrame('TRCK', String(SAMPLE.trackNo)),
      textFrame('TYER', String(SAMPLE.year)),
      pictureFrame(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4])),
    ],
    5 * 1024 * 1024,
  )
  await writeFile(join(dir, 'tagged.mp3'), withArt)
  await writeFile(join(dir, 'garbage.mp3'), 'this is not audio at all')

  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-codec-rn-conformance-app') })
  await ctx.plugin(FsNode)
  await tick()

  const counter = { bytes: 0 }
  const scoped = ctx.isolate('fs')
  await scoped.plugin(countingFs(ctx.fs, counter))
  await scoped.plugin(plugin, {})
  await tick()

  return {
    codec: scoped.codec as CodecRn,
    counter,
    uri,
    size: (await stat(join(dir, 'tagged.mp3'))).size,
  }
}

describe(codecConformance.service, () => {
  for (const check of codecConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const h = await conformanceHarness()
      await check.run({
        codec: h.codec,
        sample: {
          uri: h.uri('tagged.mp3'),
          ...SAMPLE,
          hasArtwork: true,
          sizeBytes: h.size,
        },
        garbage: h.uri('garbage.mp3'),
        missing: h.uri('nothing-here.mp3'),
        bytesRead: () => h.counter.bytes,
        resetBytes: () => {
          h.counter.bytes = 0
        },
      })
    })
  }
})
