/**
 * Tag reading against real files.
 *
 * The fixtures are built byte by byte rather than checked in: an ID3v2.3 tag
 * is a header, a length and some frames, and building one here means the test
 * says exactly what it is parsing — and that a change in the parser shows up
 * as a diff in expectations rather than in an opaque binary.
 */

import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const hasFfmpeg = (() => {
  try {
    return spawnSync('ffmpeg', ['-version']).status === 0
  } catch {
    return false
  }
})()
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { codecConformance } from '@BBeBee/protocol/conformance'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type { FsService, Uri } from '@BBeBee/protocol'
import plugin, { type CodecNode } from './index.js'

/* ── fixtures ───────────────────────────────────────────────────────────── */

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

/** An ID3v2.3 tag followed by `padding` bytes of (meaningless) audio. */
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

/* ── harness ────────────────────────────────────────────────────────────── */

/**
 * `ctx.fs`, counting the bytes actually pulled.
 *
 * Provided inside `ctx.isolate('fs')` over a reference to the real service, so
 * the codec under test sees the counter while everything else keeps the real
 * filesystem — which is exactly what isolation is for.
 */
function countingFs(real: FsService, counter: { bytes: number }) {
  // Deliberately not `implements FsService`: the delegating members are
  // installed on the prototype below, which the type system cannot see.
  class CountingFs extends Service {
    constructor(ctx: Context) {
      super(ctx, 'fs')
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
  // Everything not overridden delegates to the real service.
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
    'toPlayableUri',
  ] as const) {
    Object.defineProperty(CountingFs.prototype, key, {
      value: (...args: unknown[]) => (real[key] as (...a: unknown[]) => unknown)(...args),
    })
  }
  Object.defineProperty(CountingFs.prototype, 'canWatch', { get: () => real.canWatch })
  return CountingFs
}

async function harness() {
  const dir = await tempDir('bbebee-codec')
  const uri = (name: string) => pathToFileURL(join(dir, name)).href

  // 512 KB of padding, so "did it read the whole file" is a real question.
  const withArt = taggedMp3(
    [
      textFrame('TIT2', SAMPLE.title),
      textFrame('TPE1', SAMPLE.artist),
      textFrame('TALB', SAMPLE.album),
      textFrame('TRCK', String(SAMPLE.trackNo)),
      textFrame('TYER', String(SAMPLE.year)),
      pictureFrame(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4])),
    ],
    512 * 1024,
  )
  await writeFile(join(dir, 'tagged.mp3'), withArt)
  await writeFile(
    join(dir, 'plain.mp3'),
    taggedMp3([textFrame('TIT2', 'Untitled')], 1024),
  )
  await writeFile(join(dir, 'garbage.mp3'), 'this is not audio at all')

  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-codec-app') })
  await ctx.plugin(FsNode)
  await tick()

  const counter = { bytes: 0 }
  const scoped = ctx.isolate('fs')
  await scoped.plugin(countingFs(ctx.fs, counter))
  await scoped.plugin(plugin, {})
  await tick()

  return {
    ctx,
    scoped,
    codec: scoped.codec as CodecNode,
    counter,
    uri,
    size: (await stat(join(dir, 'tagged.mp3'))).size,
  }
}

/* ── tests ──────────────────────────────────────────────────────────────── */

describe('core-codec-node', () => {
  it('reads ID3 tags', async () => {
    const h = await harness()
    const meta = await h.codec.readMetadata(h.uri('tagged.mp3'))

    expect(meta.title).toBe(SAMPLE.title)
    expect(meta.artist).toBe(SAMPLE.artist)
    expect(meta.album).toBe(SAMPLE.album)
    expect(meta.trackNo).toBe(SAMPLE.trackNo)
    expect(meta.year).toBe(SAMPLE.year)
    expect(meta.hasArtwork).toBe(true)
    expect(meta.codec, 'the container is reported').toBeTruthy()
  })

  it('reads embedded artwork', async () => {
    const h = await harness()
    const art = await h.codec.readArtwork(h.uri('tagged.mp3'))
    expect(art).toBeInstanceOf(Uint8Array)
    expect(art!.length).toBeGreaterThan(0)
    expect(await h.codec.readArtwork(h.uri('plain.mp3'))).toBeUndefined()
  })

  it('reads a fraction of the file to read its tags', async () => {
    // The check the whole scan budget rests on.
    const h = await harness()
    h.counter.bytes = 0
    await h.codec.readMetadata(h.uri('tagged.mp3'))
    expect(h.counter.bytes).toBeGreaterThan(0)
    expect(h.counter.bytes, `read ${h.counter.bytes} of ${h.size} bytes`).toBeLessThan(h.size / 2)
  })

  it('sends PCM decoding to the audio engine instead of duplicating it', async () => {
    const h = await harness()
    await expect(h.codec.decode()).rejects.toThrow(/audio engine/)
  })

  it('lists formats in lower case', async () => {
    const h = await harness()
    const formats = h.codec.supportedFormats()
    expect(formats).toContain('flac')
    expect(formats.every((f) => f === f.toLowerCase())).toBe(true)
  })

  it.skipIf(!hasFfmpeg)('transcodes audio into requested format', async () => {
    const h = await harness()
    const numSamples = 200
    const buffer = new ArrayBuffer(44 + numSamples * 2)
    const view = new DataView(buffer)
    view.setUint32(0, 0x52494646, false) // RIFF
    view.setUint32(4, 36 + numSamples * 2, true)
    view.setUint32(8, 0x57415645, false) // WAVE
    view.setUint32(12, 0x666d7420, false) // fmt 
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // 1 channel
    view.setUint32(24, 44100, true) // 44100 Hz
    view.setUint32(28, 88200, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    view.setUint32(36, 0x64617461, false) // data
    view.setUint32(40, numSamples * 2, true)

    await writeFile(new URL(h.uri('sample.wav')), new Uint8Array(buffer))
    const res = await h.codec.transcode?.({
      inputUri: h.uri('sample.wav'),
      outputUri: h.uri('sample.flac'),
      targetFormat: 'flac',
    })
    expect(res?.ok).toBe(true)
  })

  it.skipIf(!hasFfmpeg)('preserves artwork and metadata when transcoding to supported formats', async () => {
    const h = await harness()
    const wavPath = new URL(h.uri('source.wav')).pathname
    const flacWithArtPath = new URL(h.uri('source_art.flac')).pathname
    const imgPath = new URL(h.uri('cover.jpg')).pathname

    const sampleRate = 44100
    const durationSec = 1
    const numSamples = sampleRate * durationSec
    const buffer = new ArrayBuffer(44 + numSamples * 2)
    const view = new DataView(buffer)
    view.setUint32(0, 0x52494646, false)
    view.setUint32(4, 36 + numSamples * 2, true)
    view.setUint32(8, 0x57415645, false)
    view.setUint32(12, 0x666d7420, false)
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, 44100, true)
    view.setUint32(28, 88200, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    view.setUint32(36, 0x64617461, false)
    view.setUint32(40, numSamples * 2, true)
    await writeFile(wavPath, new Uint8Array(buffer))

    const jpegBytes = Buffer.from(
      'ffd8ffe000104a46494600010200000100010000fffe00104c61766336312e31392e31303100ffdb0043000804040404040505050505050606060606060606060606060607070708080807070706060707080808080909090808080809090a0a0a0c0c0b0b0e0e0e111114ffc4004c0001010000000000000000000000000000000601010100000000000000000000000000000607100100000000000000000000000000000000110100000000000000000000000000000000ffc0001108000a000a03012200021100031100ffda000c03010002110311003f008b00517f7fffd9',
      'hex',
    )
    await writeFile(imgPath, jpegBytes)

    const { execFileSync } = await import('node:child_process')
    execFileSync('ffmpeg', [
      '-y',
      '-i',
      wavPath,
      '-i',
      imgPath,
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:a',
      'flac',
      '-c:v',
      'copy',
      '-disposition:v',
      'attached_pic',
      '-metadata',
      'title=TestTitle',
      '-metadata',
      'artist=TestArtist',
      flacWithArtPath,
    ])

    // Transcode flac -> mp3
    const resMp3 = await h.codec.transcode?.({
      inputUri: h.uri('source_art.flac'),
      outputUri: h.uri('target.mp3'),
      targetFormat: 'mp3',
    })
    expect(resMp3?.ok).toBe(true)

    const metaMp3 = await h.codec.readMetadata(h.uri('target.mp3'))
    expect(metaMp3.title).toBe('TestTitle')
    expect(metaMp3.artist).toBe('TestArtist')
    expect(metaMp3.hasArtwork).toBe(true)

    const art = await h.codec.readArtwork(h.uri('target.mp3'))
    expect(art).toBeInstanceOf(Uint8Array)
    expect(art!.length).toBeGreaterThan(0)

    // Transcode flac -> wav (which does not support artwork, should succeed cleanly with -vn)
    const resWav = await h.codec.transcode?.({
      inputUri: h.uri('source_art.flac'),
      outputUri: h.uri('target.wav'),
      targetFormat: 'wav',
    })
    expect(resWav?.ok).toBe(true)
    const metaWav = await h.codec.readMetadata(h.uri('target.wav'))
    expect(metaWav.title).toBe('TestTitle')
  })

  it('reports error when transcoding invalid input', async () => {
    const h = await harness()
    const res = await h.codec.transcode?.({
      inputUri: h.uri('garbage.mp3'),
      outputUri: h.uri('invalid.flac'),
      targetFormat: 'flac',
    })
    expect(res?.ok).toBe(false)
    expect(res?.error).toBeDefined()
  })

  it('detects encoder capabilities dynamically', async () => {
    const h = await harness()
    const caps = await h.codec.getEncoderCapabilities?.()
    expect(caps).toBeDefined()
    expect(caps?.supportedInputFormats).toContain('mp3')
    expect(caps?.supportedOutputFormats.length).toBeGreaterThan(0)
    expect(caps?.encoders).toBeDefined()
  })

  it('respects abort signal when transcoding', async () => {
    const h = await harness()
    const controller = new AbortController()
    controller.abort()
    const res = await h.codec.transcode?.({
      inputUri: h.uri('sample.wav'),
      outputUri: h.uri('aborted.flac'),
      targetFormat: 'flac',
      signal: controller.signal,
    })
    expect(res?.ok).toBe(false)
    expect(res?.error).toBe('Cancelled')
  })

  it('forwards to window.BBeBee.audio.transcode if exposed', async () => {
    const h = await harness()
    let calledOpts: any
    let calledProgress: any
    let cancelledJobId: string | undefined
    const mockTranscode = async (opts: any, onProg?: any) => {
      calledOpts = opts
      calledProgress = onProg
      return { ok: true }
    }
    const mockCancel = async (jobId: string) => {
      cancelledJobId = jobId
      return true
    }
    ;(globalThis as any).window = {
      BBeBee: {
        audio: {
          transcode: mockTranscode,
          cancelTranscode: mockCancel,
        },
      },
    }
    try {
      const controller = new AbortController()
      const onProg = () => {}
      const resPromise = h.codec.transcode?.({
        inputUri: h.uri('sample.wav'),
        outputUri: h.uri('bridge.mp3'),
        targetFormat: 'mp3',
        signal: controller.signal,
        onProgress: onProg,
      })
      controller.abort()
      const res = await resPromise
      expect(res?.ok).toBe(true)
      expect(calledOpts).toBeDefined()
      expect(calledOpts.targetFormat).toBe('mp3')
      expect(calledProgress).toBe(onProg)
      expect(cancelledJobId).toBeDefined()
    } finally {
      delete (globalThis as any).window
    }
  })

  it('leaves nothing behind when unloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-codec-leak') })
    await ctx.plugin(FsNode)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})

describe(codecConformance.service, () => {
  for (const check of codecConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const h = await harness()
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
