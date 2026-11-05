import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import { Context as CordisContext } from 'cordis'
import { VisualizerPlugin, apply, name, inject, NativeMpvImpl } from './index.js'
import { DEFAULT_VISUALIZER_SETTINGS } from '@BBeBee/protocol'

describe('plugin-visualizer', () => {
  it('declares correct name and dependencies', () => {
    expect(name).toBe('plugin-visualizer')
    expect(inject).toEqual(['audio', 'settings'])
  })

  it('initializes and attaches AnalyserNode to audio chain', async () => {
    const mockAnalyser = {
      fftSize: 128,
      smoothingTimeConstant: 0.8,
      getByteFrequencyData: vi.fn((arr: Uint8Array) => {
        arr.fill(100)
      }),
      getByteTimeDomainData: vi.fn((arr: Uint8Array) => {
        arr.fill(130)
      }),
    }

    const mockChainOutput = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }

    const mockAudioContext = {
      createAnalyser: vi.fn(() => mockAnalyser),
    }

    const mockCtx = new CordisContext() as unknown as Context
    const untyped = mockCtx as unknown as Record<string, unknown>
    untyped['audio'] = {
      context: mockAudioContext,
      chainOutput: mockChainOutput,
      chainInput: {},
    }
    untyped['settings'] = {
      getSync: vi.fn(() => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      get: vi.fn(async () => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      update: vi.fn(async (patch) => patch),
    }

    const plugin = new VisualizerPlugin(mockCtx)
    await plugin[VisualizerPlugin.init]()

    expect(mockAudioContext.createAnalyser).toHaveBeenCalled()
    expect(mockChainOutput.connect).toHaveBeenCalledWith(mockAnalyser)
    expect(plugin.settings).toEqual(DEFAULT_VISUALIZER_SETTINGS)

    // Test getFrequencyData
    const freq = new Uint8Array(64)
    plugin.getFrequencyData(freq)
    expect(mockAnalyser.getByteFrequencyData).toHaveBeenCalled()
    expect(freq[0]).toBe(100)

    // Test getTimeDomainData
    const wave = new Uint8Array(128)
    plugin.getTimeDomainData(wave)
    expect(mockAnalyser.getByteTimeDomainData).toHaveBeenCalled()
    expect(wave[0]).toBe(130)

    // Test updateSettings
    await plugin.updateSettings({ style: 'wave', sensitivity: 1.5 })
    expect(plugin.settings.style).toBe('wave')
    expect(plugin.settings.sensitivity).toBe(1.5)
    expect((untyped['settings'] as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalled()

    // Test teardown
    ;(plugin as unknown as { detachAnalyser(): void }).detachAnalyser()
    expect(mockChainOutput.disconnect).toHaveBeenCalledWith(mockAnalyser)
  })

  it('runs apply lifecycle cleanly', async () => {
    const mockCtx = new CordisContext() as unknown as Context
    const untyped = mockCtx as unknown as Record<string, unknown>
    untyped['audio'] = {
      context: { createAnalyser: vi.fn(() => ({})) },
      chainOutput: { connect: vi.fn(), disconnect: vi.fn() },
    }
    untyped['settings'] = {
      getSync: vi.fn(() => ({})),
      get: vi.fn(async () => ({})),
      update: vi.fn(),
    }

    const dispose = await apply(mockCtx)
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('attaches NativeMpvImpl when active engine is mpv', async () => {
    const mockSpectrum = {
      frequencyData: [50, 100, 150, 200],
      timeDomainData: [128, 140, 128, 120],
    }

    const mockCtx = new CordisContext() as unknown as Context
    const untyped = mockCtx as unknown as Record<string, unknown>
    untyped['audio'] = {
      activeEngineName: 'mpv',
      getFftSpectrum: vi.fn(async () => mockSpectrum),
    }
    untyped['settings'] = {
      getSync: vi.fn(() => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      get: vi.fn(async () => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      update: vi.fn(),
    }

    const plugin = new VisualizerPlugin(mockCtx)
    await plugin[VisualizerPlugin.init]()

    expect(plugin.currentAnalyser).toBeDefined()
    expect(plugin.analyserNode).toBeNull() // No Web Audio AnalyserNode in MPV mode

    // Manually feed a frame to NativeMpvImpl
    ;(plugin.currentAnalyser as unknown as { feedFrame(f: unknown): void }).feedFrame(mockSpectrum)

    const freq = new Uint8Array(4)
    plugin.getFrequencyData(freq)
    expect(freq.length).toBe(4)
    // Non-zero frequency data returned
    expect(freq[0]).toBeGreaterThan(0)

    const wave = new Uint8Array(4)
    plugin.getTimeDomainData(wave)
    expect(wave.length).toBe(4)

    plugin.currentAnalyser?.dispose()
  })

  it('attaches NativeMpvImpl when active engine is wasapi and notifies setVisualizer', async () => {
    const mockSpectrum = {
      frequencyData: [60, 120, 180, 240],
      timeDomainData: [128, 150, 128, 100],
    }
    const setVisualizerMock = vi.fn(async () => {})

    const mockCtx = new CordisContext() as unknown as Context
    const untyped = mockCtx as unknown as Record<string, unknown>
    untyped['audio'] = {
      activeEngineName: 'wasapi',
      getFftSpectrum: vi.fn(async () => mockSpectrum),
      setVisualizer: setVisualizerMock,
    }
    untyped['settings'] = {
      getSync: vi.fn(() => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      get: vi.fn(async () => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      update: vi.fn(),
    }

    const plugin = new VisualizerPlugin(mockCtx)
    await plugin[VisualizerPlugin.init]()

    expect(plugin.currentAnalyser).toBeDefined()
    expect(plugin.analyserNode).toBeNull()
    expect(setVisualizerMock).toHaveBeenCalledWith(true, 128)

    // Feed frame and verify data extraction
    ;(plugin.currentAnalyser as unknown as { feedFrame(f: unknown): void }).feedFrame(mockSpectrum)
    const freq = new Uint8Array(4)
    plugin.getFrequencyData(freq)
    expect(freq[0]).toBeGreaterThan(0)

    // Dispose should notify setVisualizer(false)
    ;(plugin as unknown as { detachAnalyser(): void }).detachAnalyser()
    expect(setVisualizerMock).toHaveBeenCalledWith(false)
  })

  it('attaches WebAudioImpl when the engine reports the PCM tap unavailable', async () => {
    // Stock libmpv never yields PCM to the FFT pipeline — every frame is
    // silence. An explicit `pcmTapAvailable: false` must steer the analyser
    // to the Web Audio graph instead of polling zero frames forever. A mock
    // engine without `getEngineStatus` (the default-true rule) keeps
    // attaching NativeMpvImpl — covered by the mpv/wasapi tests above.
    const mockAnalyser = {
      fftSize: 128,
      smoothingTimeConstant: 0.8,
      getByteFrequencyData: vi.fn((arr: Uint8Array) => {
        arr.fill(90)
      }),
      getByteTimeDomainData: vi.fn(),
      disconnect: vi.fn(),
    }
    const mockChainOutput = { connect: vi.fn(), disconnect: vi.fn() }
    const mockAudioContext = { createAnalyser: vi.fn(() => mockAnalyser) }

    const mockCtx = new CordisContext() as unknown as Context
    const untyped = mockCtx as unknown as Record<string, unknown>
    untyped['audio'] = {
      activeEngineName: 'mpv',
      getFftSpectrum: vi.fn(async () => ({ frequencyData: [], timeDomainData: [] })),
      getEngineStatus: vi.fn(async () => ({
        running: true,
        mpvAvailable: true,
        pcmTapAvailable: false,
      })),
      context: mockAudioContext,
      chainOutput: mockChainOutput,
    }
    untyped['settings'] = {
      getSync: vi.fn(() => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      get: vi.fn(async () => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      update: vi.fn(),
    }

    const plugin = new VisualizerPlugin(mockCtx)
    await plugin[VisualizerPlugin.init]()

    expect(mockAudioContext.createAnalyser).toHaveBeenCalled()
    expect(mockChainOutput.connect).toHaveBeenCalledWith(mockAnalyser)
    expect(plugin.currentAnalyser).toBeDefined()
    expect(plugin.analyserNode).toBe(mockAnalyser)
    ;(plugin as unknown as { detachAnalyser(): void }).detachAnalyser()
  })

  it('pauses NativeMpvImpl polling when document becomes hidden and resumes when visible', async () => {
    vi.useFakeTimers()
    let isHidden = false
    const listeners: Record<string, (() => void)[]> = {}
    const originalDoc = globalThis.document

    const mockDoc = {
      get hidden() {
        return isHidden
      },
      addEventListener: vi.fn((event: string, cb: () => void) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
      }),
      removeEventListener: vi.fn((event: string, cb: () => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((fn) => fn !== cb)
        }
      }),
    }
    vi.stubGlobal('document', mockDoc)

    try {
      const fetchMock = vi.fn(async () => ({
        frequencyData: [10, 20],
        timeDomainData: [128, 128],
      }))

      const analyser = new NativeMpvImpl({
        fftSize: 32,
        fetchSpectrum: fetchMock,
      })

      // Active state: timer runs and calls fetchMock
      await vi.advanceTimersByTimeAsync(32)
      expect(fetchMock).toHaveBeenCalled()
      const callsBefore = fetchMock.mock.calls.length

      // Simulate document minimization/hidden
      isHidden = true
      listeners['visibilitychange']?.forEach((cb) => cb())

      await vi.advanceTimersByTimeAsync(64)
      // No new calls while hidden
      expect(fetchMock.mock.calls.length).toBe(callsBefore)

      // Simulate document restore to visible
      isHidden = false
      listeners['visibilitychange']?.forEach((cb) => cb())

      await vi.advanceTimersByTimeAsync(32)
      // Calls resume
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore)

      // Test explicit pause / resume
      const callsBeforePause = fetchMock.mock.calls.length
      analyser.pause()
      await vi.advanceTimersByTimeAsync(64)
      expect(fetchMock.mock.calls.length).toBe(callsBeforePause)

      analyser.resume()
      await vi.advanceTimersByTimeAsync(32)
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforePause)

      analyser.dispose()
      expect(mockDoc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    } finally {
      if (originalDoc) {
        vi.stubGlobal('document', originalDoc)
      } else {
        vi.unstubAllGlobals()
      }
      vi.useRealTimers()
    }
  })

  it('only polls NativeMpvImpl when consumers are attached if lazy is true', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => ({
        frequencyData: [10, 20],
        timeDomainData: [128, 128],
      }))

      const analyser = new NativeMpvImpl({
        fftSize: 32,
        fetchSpectrum: fetchMock,
        lazy: true,
      })

      // No consumers attached: should not poll
      await vi.advanceTimersByTimeAsync(64)
      expect(fetchMock).not.toHaveBeenCalled()

      // Attach consumer 1
      const detach1 = analyser.attachConsumer()
      await vi.advanceTimersByTimeAsync(32)
      expect(fetchMock).toHaveBeenCalled()
      const callsAfterFirstAttach = fetchMock.mock.calls.length

      // Attach consumer 2
      const detach2 = analyser.attachConsumer()
      await vi.advanceTimersByTimeAsync(32)
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstAttach)

      // Detach consumer 1 (consumer 2 still active)
      detach1()
      const callsAfterDetach1 = fetchMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(32)
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterDetach1)

      // Detach consumer 2 (0 consumers left)
      detach2()
      const callsAfterDetach2 = fetchMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(64)
      // Polling has stopped completely
      expect(fetchMock.mock.calls.length).toBe(callsAfterDetach2)

      analyser.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('manages consumers across plugin and responds to player/state-changed', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => ({
        frequencyData: [10, 20],
        timeDomainData: [128, 128],
      }))

      const mockCtx = new CordisContext() as unknown as Context
      const untyped = mockCtx as unknown as Record<string, unknown>
      untyped['audio'] = {
        activeEngineName: 'mpv',
        getFftSpectrum: fetchMock,
      }
      untyped['settings'] = {
        getSync: vi.fn(() => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
        get: vi.fn(async () => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
        update: vi.fn(),
      }

      const plugin = new VisualizerPlugin(mockCtx)
      await plugin[VisualizerPlugin.init]()

      // Initially no UI consumers attached: no polling
      await vi.advanceTimersByTimeAsync(64)
      expect(fetchMock).not.toHaveBeenCalled()

      // Attach a UI consumer via plugin
      const detach = plugin.attachConsumer()
      await vi.advanceTimersByTimeAsync(32)
      expect(fetchMock).toHaveBeenCalled()
      const callsWhilePlaying = fetchMock.mock.calls.length

      // Player pauses: player/state-changed status: 'paused'
      mockCtx.emit('player/state-changed', { status: 'paused' } as never)
      await vi.advanceTimersByTimeAsync(64)
      // Polling paused
      expect(fetchMock.mock.calls.length).toBe(callsWhilePlaying)

      // Player resumes: player/state-changed status: 'playing'
      mockCtx.emit('player/state-changed', { status: 'playing' } as never)
      await vi.advanceTimersByTimeAsync(32)
      // Polling resumed
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsWhilePlaying)

      // Detach consumer
      detach()
      const callsAfterDetach = fetchMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(64)
      expect(fetchMock.mock.calls.length).toBe(callsAfterDetach)

      ;(plugin as unknown as { detachAnalyser(): void }).detachAnalyser()
    } finally {
      vi.useRealTimers()
    }
  })
})

