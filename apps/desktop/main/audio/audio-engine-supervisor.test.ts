import { describe, expect, it, afterEach, beforeAll } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AudioEngineSupervisor, loadTimeoutMs, type CrashEvent, type FftFrame, type PlaybackStateEvent } from './audio-engine-supervisor.js'

/**
 * A real one-and-a-half-second tone. When the engine runs with libmpv, this
 * is what gets decoded and measured; without it, the fallback branch reports
 * its nominal duration instead — both modes satisfy the assertions below.
 */
const testWavDir = join(tmpdir(), 'bbebee-supervisor-test')
const testWav = join(testWavDir, 'tone.wav')
const testWavUri = `file://${testWav.split(/[/\\]/).map(encodeURIComponent).join('/')}`

beforeAll(() => {
  mkdirSync(testWavDir, { recursive: true })
  const rate = 44100
  const seconds = 6
  const data = Buffer.alloc(Math.round(seconds * rate) * 2)
  for (let i = 0; i < data.length / 2; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.4 * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(testWav, Buffer.concat([header, data]))
})

describe('loadTimeoutMs', () => {
  it('gives http(s) streams double the local budget', () => {
    // A timeout rejects the load, which the renderer reads as an engine
    // failure and answers by degrading to the media element. A healthy but
    // slow network stream (TLS handshake plus initial buffering) must not be
    // condemned by the budget sized for local files.
    expect(loadTimeoutMs('https://radio.example.org/stream.aac')).toBe(30_000)
    expect(loadTimeoutMs('http://radio.example.org/stream.mp3')).toBe(30_000)
    expect(loadTimeoutMs('HTTPS://radio.example.org/live')).toBe(30_000)
    expect(loadTimeoutMs('file:///music/song.flac')).toBe(15_000)
    expect(loadTimeoutMs('/music/song.flac')).toBe(15_000)
  })
})

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

    await supervisor.load(testWavUri)
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

    await supervisor.load(testWavUri)
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

  it('fails fast on load when executable is not found', async () => {
    supervisor = new AudioEngineSupervisor(undefined, '/non/existent/path/to/audio-engine')
    await expect(supervisor.load('file:///music/test.flac')).rejects.toThrow(
      /Audio engine executable not found/,
    )
  })

  it('fails fast on append when executable is not found', async () => {
    supervisor = new AudioEngineSupervisor(undefined, '/non/existent/path/to/audio-engine')
    await expect(supervisor.append('file:///music/next.flac')).rejects.toThrow(
      /Audio engine executable not found/,
    )
  })

  it('appends tracks for gapless playback', async () => {
    supervisor = new AudioEngineSupervisor()
    const readyPromise = new Promise<void>((resolve) => {
      supervisor!.onReady(() => resolve())
    })
    supervisor.start()
    await readyPromise

    await expect(supervisor.append('file:///music/next-gapless.flac')).resolves.toBeUndefined()
  })

  it('queries native audio devices list', async () => {
    supervisor = new AudioEngineSupervisor()
    const readyPromise = new Promise<void>((resolve) => {
      supervisor!.onReady(() => resolve())
    })
    supervisor.start()
    await readyPromise

    const devices = await supervisor.getAudioDevices()
    expect(Array.isArray(devices)).toBe(true)
    expect(devices.length).toBeGreaterThan(0)
    expect(devices[0]!.name).toBeDefined()
  })

  it('reports engine health and honours the ready message mpv flag', async () => {
    supervisor = new AudioEngineSupervisor()
    const readyPromise = new Promise<void>((resolve) => {
      supervisor!.onReady(() => resolve())
    })
    supervisor.start()
    await readyPromise

    const status = supervisor.getEngineStatus()
    expect(status.running).toBe(true)
    expect(typeof status.mpvAvailable).toBe('boolean')

    const dispatch = (msg: unknown) =>
      (supervisor as unknown as { handleWorkerMessage(m: unknown): void }).handleWorkerMessage(msg)

    // An engine that says libmpv failed to load is the degradation the
    // settings page must surface.
    dispatch({ type: 'ready', mpvAvailable: false })
    expect(supervisor.getEngineStatus().mpvAvailable).toBe(false)

    // A binary predating the field is not proof of degradation.
    dispatch({ type: 'ready' })
    expect(supervisor.getEngineStatus().mpvAvailable, 'legacy ready stays healthy').toBe(true)
  })

  it('forwards the stream playback flag for the degraded visualizer', () => {
    supervisor = new AudioEngineSupervisor()
    const sent: Array<Record<string, unknown>> = []
    ;(supervisor as unknown as { sendCommand(c: Record<string, unknown>): void }).sendCommand = (c) => {
      sent.push(c)
    }

    supervisor.setStreamPlayback(true)
    supervisor.setStreamPlayback(false)

    expect(sent).toEqual([
      { action: 'setStreamPlayback', playing: true },
      { action: 'setStreamPlayback', playing: false },
    ])
  })
})
