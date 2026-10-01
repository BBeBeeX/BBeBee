import { describe, expect, it, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { AudioEngineSupervisor, type CrashEvent, type FftFrame, type PlaybackStateEvent } from './audio-engine-supervisor.js'

describe('AudioEngineSupervisor standalone native executable', () => {
  let supervisor: AudioEngineSupervisor | null = null

  afterEach(async () => {
    await supervisor?.shutdown()
    supervisor = null
  })

  it('resolves the standalone executable binary path', () => {
    supervisor = new AudioEngineSupervisor()
    const exePath = supervisor.resolveExecutablePath()

    // In this repo after build:audio-engine, the binary should exist in apps/desktop/bin
    if (exePath) {
      expect(existsSync(exePath)).toBe(true)
      expect(exePath.includes('audio-engine')).toBe(true)
    }
  })

  it('spawns and receives ready event from standalone audio-engine', async () => {
    supervisor = new AudioEngineSupervisor({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    })

    const readyPromise = new Promise<void>((resolve) => {
      supervisor!.onReady(() => resolve())
    })

    supervisor.start()
    await expect(readyPromise).resolves.toBeUndefined()
  })

  it('dispatches transport commands and receives playback state updates', async () => {
    supervisor = new AudioEngineSupervisor()

    const readyPromise = new Promise<void>((resolve) => {
      supervisor!.onReady(() => resolve())
    })
    supervisor.start()
    await readyPromise

    const states: PlaybackStateEvent[] = []
    supervisor.onStateChange((e) => states.push(e))

    await supervisor.load('file:///music/test.flac')
    supervisor.play(1000)

    // Wait for state updates
    await new Promise((r) => setTimeout(r, 150))

    expect(states.length).toBeGreaterThan(0)
    expect(states.some((s) => s.status === 'playing')).toBe(true)

    supervisor.pause()
    await new Promise((r) => setTimeout(r, 50))
    expect(states.some((s) => s.status === 'paused')).toBe(true)

    supervisor.stop()
    await new Promise((r) => setTimeout(r, 50))
    expect(states.some((s) => s.status === 'stopped')).toBe(true)
  })

  it('streams FFT spectrum frames without raw PCM crossing IPC', async () => {
    supervisor = new AudioEngineSupervisor()
    const readyPromise = new Promise<void>((resolve) => {
      supervisor!.onReady(() => resolve())
    })
    supervisor.start()
    await readyPromise

    const frames: FftFrame[] = []
    supervisor.onFftFrame((f) => frames.push(f))

    await supervisor.load('file:///music/test.flac')
    supervisor.setVisualizer(true, 128)
    supervisor.play(0)

    // Wait for visualizer loop to generate frames
    await new Promise((r) => setTimeout(r, 200))

    expect(frames.length).toBeGreaterThan(0)
    const sampleFrame = frames[0]!
    expect(sampleFrame.frequencyData).toBeDefined()
    expect(sampleFrame.frequencyData.length).toBe(64) // 128 / 2
    expect(sampleFrame.timeDomainData).toBeDefined()
    expect(sampleFrame.timeDomainData.length).toBe(128) // fftSize
  })

  it('isolates child process crash and notifies listeners', async () => {
    supervisor = new AudioEngineSupervisor()
    const readyPromise = new Promise<void>((resolve) => {
      supervisor!.onReady(() => resolve())
    })
    supervisor.start()
    await readyPromise

    const crashes: CrashEvent[] = []
    supervisor.onCrash((e) => crashes.push(e))

    // Access the child process directly to simulate a crash (SIGTERM)
    const child = (supervisor as unknown as { child: { kill(signal: string): void } }).child
    expect(child).toBeDefined()
    child.kill('SIGTERM')

    // Wait for exit handler
    await new Promise((r) => setTimeout(r, 100))

    expect(crashes.length).toBe(1)
    expect(crashes[0]!.restarting).toBe(true)
  })
})
