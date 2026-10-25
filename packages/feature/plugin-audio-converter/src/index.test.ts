import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { Context } from 'cordis'

const hasFfmpeg = (() => {
  try {
    return spawnSync('ffmpeg', ['-version']).status === 0
  } catch {
    return false
  }
})()
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { CodecNode } from '@bbebee/core-codec-node'
import plugin from './index.js'
import { AUDIO_CONVERTER_VIEWS } from './views.js'
import { estimateCompression, resolvePresetOptions } from './compression.js'
import { computeTempPath, ensureSafeTarget, validateAndNormalizePath, validateFormat } from './security.js'

async function setupHarness() {
  const root = await tempDir('bbebee-converter-test')
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root })
  await ctx.plugin(FsNode)
  // A deterministic encoder probe: the machine this runs on may have no
  // ffmpeg, and an honest empty probe means no output formats — the
  // capabilities test asserts parsing, not whatever PATH happens to hold.
  await ctx.plugin(CodecNode, {
    probeEncoders: async () =>
      ' A..... flac                 FLAC (Free Lossless Audio Codec)\n' +
      ' A..... libmp3lame           LAME (MP3) encoder\n' +
      ' A..... libopus              Opus encoder\n',
  })
  return { ctx, root }
}

describe('plugin-audio-converter security & heuristics', () => {
  it('validates and normalizes paths and rejects traversal attempts', () => {
    expect(() => validateAndNormalizePath('../outside.mp3')).toThrow(/traversal/)
    expect(() => validateAndNormalizePath('audio/../../etc/passwd')).toThrow(/traversal/)
    expect(() => validateAndNormalizePath('track\0.mp3')).toThrow(/forbidden/)
    expect(validateAndNormalizePath('/home/music/song.wav')).toBe('/home/music/song.wav')
    expect(validateAndNormalizePath('H:\\dockerResource\\Jellyfin\\media\\01 - You Raise Me Up.flac')).toBe(
      'H:/dockerResource/Jellyfin/media/01 - You Raise Me Up.flac',
    )
  })

  it('validates audio formats and detects invalid ones', () => {
    expect(validateFormat('MP3')).toBe('mp3')
    expect(validateFormat('flac')).toBe('flac')
    expect(() => validateFormat('exe')).toThrow(/Unsupported audio format/)
  })

  it('prevents overwriting source file unless permitted', () => {
    expect(() => ensureSafeTarget('/music/test.wav', '/music/test.wav', false)).toThrow(/Overwriting/)
    expect(() => ensureSafeTarget('/music/test.wav', '/music/test.wav', true)).not.toThrow()
  })

  it('computes safe hidden temp path in parent directory', () => {
    const temp = computeTempPath('/music/output.mp3')
    expect(temp).toContain('/music/.output.tmp_')
    expect(temp.endsWith('.mp3')).toBe(true)

    const winTemp = computeTempPath('H:\\dockerResource\\Jellyfin\\media\\01 - You Raise Me Up.flac')
    expect(winTemp).toContain('H:/dockerResource/Jellyfin/media/.01 - You Raise Me Up.tmp_')
    expect(winTemp.endsWith('.flac')).toBe(true)
  })

  it('calculates compression estimates and warns on lossy re-encoding', () => {
    const estLossyToLossless = estimateCompression({
      durationMs: 60_000,
      sourceSize: 2_000_000,
      targetFormat: 'flac',
      sourceFormat: 'mp3',
    })
    expect(estLossyToLossless.isLossless).toBe(true)
    expect(estLossyToLossless.warning).toBeDefined()

    const estLossy = estimateCompression({
      durationMs: 120_000,
      sourceSize: 10_000_000,
      targetFormat: 'mp3',
      bitrateKbps: 128,
    })
    expect(estLossy.isLossless).toBe(false)
    expect(estLossy.estimatedSize).toBeGreaterThan(0)
    expect(estLossy.estimatedSize).toBeLessThan(10_000_000)
  })

  it('resolves preset options properly', () => {
    const speech = resolvePresetOptions('speech', 'mp3')
    expect(speech.channels).toBe(1)
    expect(speech.bitrateKbps).toBe(64)

    const high = resolvePresetOptions('high_quality', 'flac')
    expect(high.bitDepth).toBe(24)
    expect(high.bitrateKbps).toBeUndefined()
  })
})

describe('plugin-audio-converter service & lifecycle', () => {
  it('registers audioConverter service and unregisters cleanly', async () => {
    const { ctx } = await setupHarness()
    const fiber = await ctx.plugin(plugin)
    await tick()

    expect(ctx.audioConverter).toBeDefined()
    expect(typeof ctx.audioConverter.convertDirect).toBe('function')
    expect(typeof ctx.audioConverter.getCapabilities).toBe('function')

    await fiber.dispose()
    await tick()
  })

  it('provides capabilities from codec engine', async () => {
    const { ctx } = await setupHarness()
    await ctx.plugin(plugin)
    await tick()

    const caps = await ctx.audioConverter.getCapabilities()
    expect(caps.supportedInputFormats).toContain('mp3')
    expect(caps.supportedOutputFormats).toContain('flac')
    expect(caps.encoders).toBeDefined()
  })

  it.skipIf(!hasFfmpeg)('handles direct conversion and validates output', async () => {
    const { ctx, root } = await setupHarness()
    await ctx.plugin(plugin)
    await tick()

    // Write a dummy wav file
    const inUri = `${root}/test.wav`
    const outUri = `${root}/test.flac`

    // Generate small 0.1s WAV PCM header + data
    const numSamples = 4410
    const buffer = new ArrayBuffer(44 + numSamples * 2)
    const view = new DataView(buffer)
    view.setUint32(0, 0x52494646, false) // RIFF
    view.setUint32(4, 36 + numSamples * 2, true)
    view.setUint32(8, 0x57415645, false) // WAVE
    view.setUint32(12, 0x666d7420, false) // fmt
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, 44100, true)
    view.setUint32(28, 88200, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    view.setUint32(36, 0x64617461, false) // data
    view.setUint32(40, numSamples * 2, true)

    await ctx.fs.writeFile(inUri, new Uint8Array(buffer))

    const stages: string[] = []
    const res = await ctx.audioConverter.convertDirect({
      inputUri: inUri,
      outputUri: outUri,
      targetFormat: 'flac',
      onProgress: (_pct, stage) => {
        if (!stages.includes(stage)) stages.push(stage)
      },
    })

    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(res.outputSize).toBeGreaterThan(0)
    expect(stages).toContain('encoding')

    const outStat = await ctx.fs.stat(outUri)
    expect(outStat.size).toBe(res.outputSize)
  })

  it.skipIf(!hasFfmpeg)('enqueues tasks and processes queue with progress and status updates', async () => {
    const { ctx, root } = await setupHarness()
    await ctx.plugin(plugin)
    await tick()

    const inUri = `${root}/queued.wav`
    const buffer = new ArrayBuffer(44 + 4410 * 2)
    const view = new DataView(buffer)
    view.setUint32(0, 0x52494646, false)
    view.setUint32(4, 36 + 4410 * 2, true)
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
    view.setUint32(40, 4410 * 2, true)

    await ctx.fs.writeFile(inUri, new Uint8Array(buffer))

    let completedEventFired = false
    ctx.on('audio-converter/task-completed', () => {
      completedEventFired = true
    })

    const tasks = await ctx.audioConverter.enqueue([
      { uri: inUri, options: { targetFormat: 'mp3', bitrateKbps: 192 } },
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.targetFormat).toBe('mp3')
    expect(ctx.audioConverter.getTasks().length).toBeGreaterThan(0)

    // Wait for task execution
    let attempts = 0
    while (attempts < 30 && !completedEventFired) {
      await tick()
      await new Promise((r) => setTimeout(r, 100))
      attempts++
    }

    const currentTasks = ctx.audioConverter.getTasks()
    const task = currentTasks.find((t) => t.id === tasks[0]!.id)
    expect(task).toBeDefined()
    expect(task?.status).toBe('completed')
    expect(task?.progress).toBe(100)
    expect(completedEventFired).toBe(true)

    // Clear finished
    await ctx.audioConverter.clearFinished()
    expect(ctx.audioConverter.getTasks()).toHaveLength(0)
  })

  it('cancels a task and cleans up temporary files', async () => {
    const { ctx, root } = await setupHarness()
    await ctx.plugin(plugin)
    await tick()

    const inUri = `${root}/to_cancel.wav`
    await ctx.fs.writeFile(inUri, new Uint8Array(100))

    const tasks = await ctx.audioConverter.enqueue([
      { uri: inUri, options: { targetFormat: 'flac' } },
    ])
    const taskId = tasks[0]!.id

    const cancelled = await ctx.audioConverter.cancelTask(taskId)
    expect(cancelled).toBe(true)

    const task = ctx.audioConverter.getTasks().find((t) => t.id === taskId)
    expect(task?.status).toBe('cancelled')
  })

  it('contributes route and tray items when UI service is present', async () => {
    const { ctx } = await setupHarness()

    // Mock UI service
    const contributions: any[] = []
    ctx.provide('ui')
    ctx.ui = {
      contribute: (c: any) => {
        contributions.push(c)
        return () => {}
      },
    } as any

    await ctx.plugin(plugin)
    await tick()

    const route = contributions.find((c) => c.kind === 'route' && c.id === AUDIO_CONVERTER_VIEWS.page)
    const tray = contributions.find((c) => c.kind === 'tray')

    expect(route).toBeDefined()
    expect(route.title).toBe('converter:index.title')
    expect(route.icon).toBe('transform')
    expect(route.placement).toContain('tray')
    expect(tray).toBeUndefined()
  })
})
