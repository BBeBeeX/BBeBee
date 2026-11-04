import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import { Context as CordisContext } from 'cordis'
import { VisualizerPlugin, apply, name, inject, NativeMpvImpl } from './index.js'
import { WebAudioImpl } from './analyser.js'
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

describe('plugin-visualizer stereo integration', () => {
  it('serves a stereo mpv frame through the plugin service methods', async () => {
    const stereoFrame = {
      frequencyData: [150, 100],
      timeDomainData: [200, 60],
      channels: 2,
      sampleRateHz: 48000,
      leftFrequencyData: [200, 50],
      leftTimeDomainData: [220, 40],
      rightFrequencyData: [10, 5],
      rightTimeDomainData: [120, 130],
    }
    const mockCtx = new CordisContext() as unknown as Context
    const untyped = mockCtx as unknown as Record<string, unknown>
    untyped['audio'] = {
      activeEngineName: 'mpv',
      getFftSpectrum: vi.fn(async () => stereoFrame),
      getEngineStatus: vi.fn(async () => ({
        running: true,
        mpvAvailable: true,
        pcmTapAvailable: true,
      })),
      setVisualizer: vi.fn(async () => {}),
    }
    untyped['settings'] = {
      getSync: vi.fn(() => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      get: vi.fn(async () => ({ visualizer: DEFAULT_VISUALIZER_SETTINGS })),
      update: vi.fn(async (patch) => patch),
    }

    const plugin = new VisualizerPlugin(mockCtx)
    await plugin[VisualizerPlugin.init]()
    // attachAnalyserAsync is fire-and-forget, and the NativeMpvImpl
    // poller runs every 16 ms: wait for the analyser, then for a poll.
    for (let i = 0; i < 100 && !(plugin.currentAnalyser instanceof NativeMpvImpl); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(plugin.currentAnalyser).toBeInstanceOf(NativeMpvImpl)
    await new Promise((r) => setTimeout(r, 60))

    expect(plugin.channels).toBe(2)
    expect(plugin.sampleRateHz).toBe(48000)
    // Time data is copied, not smoothed: exact values.
    const leftTime = new Uint8Array(128)
    plugin.getLeftTimeDomainData(leftTime)
    expect(leftTime[0]).toBe(220)
    const rightTime = new Uint8Array(128)
    plugin.getRightTimeDomainData(rightTime)
    expect(rightTime[0]).toBe(120)
    // Frequency data is smoothed (0.82), so only the ordering is
    // timing-independent: left's 200 stays above right's 10.
    const leftFreq = new Uint8Array(64)
    const rightFreq = new Uint8Array(64)
    plugin.getLeftFrequencyData(leftFreq)
    plugin.getRightFrequencyData(rightFreq)
    expect(leftFreq[0]).toBeGreaterThan(0)
    expect(leftFreq[0]).toBeGreaterThan(rightFreq[0]!)
    ;(plugin as unknown as { detachAnalyser(): void }).detachAnalyser()
  })
})

describe('NativeMpvImpl stereo frames', () => {
  it('accepts a stereo frame only as a package and clears stereo on a mono frame', () => {
    const impl = new NativeMpvImpl({ fftSize: 128, smoothingTimeConstant: 0 })
    const freq = new Uint8Array(64)
    const wave = new Uint8Array(128)

    // Incomplete stereo (channels 2 but no per-channel arrays) is a mono frame.
    impl.feedFrame({ frequencyData: [200, 100], timeDomainData: [200, 60], channels: 2 })
    expect(impl.channels).toBe(1)
    impl.getLeftByteFrequencyData(freq)
    expect(freq.every((v) => v === 0)).toBe(true)

    // Full stereo frame.
    impl.feedFrame({
      frequencyData: [150, 100],
      timeDomainData: [200, 60],
      channels: 2,
      sampleRateHz: 48000,
      leftFrequencyData: [200, 50],
      leftTimeDomainData: [220, 40],
      rightFrequencyData: [10, 5],
      rightTimeDomainData: [120, 130],
    })
    expect(impl.channels).toBe(2)
    expect(impl.sampleRateHz).toBe(48000)
    impl.getLeftByteFrequencyData(freq)
    impl.getRightByteFrequencyData(wave)
    expect(freq[0]).toBe(200)
    expect(wave[0]).toBe(10)
    impl.getLeftByteTimeDomainData(wave)
    expect(wave[0]).toBe(220)

    // A mono frame after a stereo one must not keep serving the old stereo picture.
    impl.feedFrame({ frequencyData: [150], timeDomainData: [200] })
    expect(impl.channels).toBe(1)
    impl.getLeftByteFrequencyData(freq)
    expect(freq.every((v) => v === 0)).toBe(true)
    impl.getLeftByteTimeDomainData(wave)
    expect(wave.every((v) => v === 128)).toBe(true)
    impl.dispose()
  })
})

describe('WebAudioImpl stereo', () => {
  const mockAnalyser = (freqFill: number, waveFill: number, sampleRate?: number) => ({
    fftSize: 128,
    frequencyBinCount: 64,
    smoothingTimeConstant: 0.8,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => {
      arr.fill(freqFill)
    }),
    getByteTimeDomainData: vi.fn((arr: Uint8Array) => {
      arr.fill(waveFill)
    }),
    disconnect: vi.fn(),
    ...(sampleRate ? { context: { sampleRate } } : {}),
  })

  it('splits one source into mix + left/right analysers', () => {
    const mix = mockAnalyser(150, 200, 48000)
    const left = mockAnalyser(200, 220)
    const right = mockAnalyser(10, 120)
    const splitter = { connect: vi.fn(), disconnect: vi.fn() }
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    // createStereo calls createAnalyser three times: mix, left, right.
    const analysers = [mix, left, right]
    let next = 0
    const audioCtx = {
      createAnalyser: vi.fn(() => analysers[next++]!),
      createChannelSplitter: vi.fn(() => splitter),
    }

    const impl = WebAudioImpl.createStereo(
      audioCtx as unknown as BaseAudioContext,
      source as unknown as AudioNode,
    )

    expect(source.connect).toHaveBeenCalledWith(mix)
    expect(source.connect).toHaveBeenCalledWith(splitter)
    expect(splitter.connect).toHaveBeenCalledWith(left, 0)
    expect(splitter.connect).toHaveBeenCalledWith(right, 1)
    expect(impl.channels).toBe(2)
    expect(impl.sampleRateHz).toBe(48000)

    // Mono methods keep reading the mix analyser, not the left channel.
    const freq = new Uint8Array(4)
    impl.getByteFrequencyData(freq)
    expect(freq[0]).toBe(150)
    impl.getLeftByteFrequencyData(freq)
    expect(freq[0]).toBe(200)
    impl.getRightByteFrequencyData(freq)
    expect(freq[0]).toBe(10)
    const wave = new Uint8Array(4)
    impl.getLeftByteTimeDomainData(wave)
    expect(wave[0]).toBe(220)
    impl.getRightByteTimeDomainData(wave)
    expect(wave[0]).toBe(120)

    // Config sync reaches all three analysers.
    impl.setFftSize(256)
    expect(mix.fftSize).toBe(256)
    expect(left.fftSize).toBe(256)
    expect(right.fftSize).toBe(256)
    impl.smoothingTimeConstant = 0.5
    expect(mix.smoothingTimeConstant).toBe(0.5)
    expect(left.smoothingTimeConstant).toBe(0.5)
    expect(right.smoothingTimeConstant).toBe(0.5)

    impl.dispose()
    expect(source.disconnect).toHaveBeenCalledWith(mix)
    expect(source.disconnect).toHaveBeenCalledWith(splitter)
    expect(mix.disconnect).toHaveBeenCalled()
    expect(left.disconnect).toHaveBeenCalled()
    expect(right.disconnect).toHaveBeenCalled()
  })

  it('a single node stays mono and its stereo methods fill silence', () => {
    const node = mockAnalyser(150, 200)
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const impl = new WebAudioImpl(
      node as unknown as AnalyserNode,
      source as unknown as AudioNode,
    )

    expect(impl.channels).toBe(1)
    expect(impl.sampleRateHz).toBeUndefined()
    const freq = new Uint8Array(4)
    impl.getLeftByteFrequencyData(freq)
    expect(freq.every((v) => v === 0)).toBe(true)
    impl.getRightByteFrequencyData(freq)
    expect(freq.every((v) => v === 0)).toBe(true)
    const wave = new Uint8Array(4)
    impl.getLeftByteTimeDomainData(wave)
    expect(wave.every((v) => v === 128)).toBe(true)
    impl.getRightByteTimeDomainData(wave)
    expect(wave.every((v) => v === 128)).toBe(true)
    impl.dispose()
  })

  it('plugin fallback attaches the stereo pair and serves it', async () => {
    const mix = mockAnalyser(150, 200, 44100)
    const left = mockAnalyser(200, 220)
    const right = mockAnalyser(10, 120)
    const splitter = { connect: vi.fn(), disconnect: vi.fn() }
    const analysers = [mix, left, right]
    let next = 0
    const mockAudioContext = {
      createAnalyser: vi.fn(() => analysers[next++]!),
      createChannelSplitter: vi.fn(() => splitter),
    }
    const mockChainOutput = { connect: vi.fn(), disconnect: vi.fn() }

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

    expect(plugin.currentAnalyser).toBeInstanceOf(WebAudioImpl)
    expect(plugin.channels).toBe(2)
    expect(plugin.sampleRateHz).toBe(44100)
    const freq = new Uint8Array(4)
    plugin.getLeftFrequencyData(freq)
    expect(freq[0]).toBe(200)
    plugin.getRightFrequencyData(freq)
    expect(freq[0]).toBe(10)
    // The raw node stays the mix analyser.
    expect(plugin.analyserNode).toBe(mix)
    ;(plugin as unknown as { detachAnalyser(): void }).detachAnalyser()
  })
})
