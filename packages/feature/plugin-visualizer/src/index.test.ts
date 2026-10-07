import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import { Context as CordisContext } from 'cordis'
import { VisualizerPlugin, apply, name, inject } from './index.js'
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
})
