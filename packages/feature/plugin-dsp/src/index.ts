/**
 * `plugin-dsp` — the audio effect chain service.
 *
 * Implements `ctx.dsp` and manages the dynamic DSP chain spliced between
 * `ctx.audio.chainInput` and `ctx.audio.chainOutput`.
 *
 * See docs/05-audio-playback.md §3 and docs/10-roadmap.md §M4.
 */

import { Service, type Context } from '@BBeBee/kernel'
import type {
  AppSettings,
  ChainEntry,
  Disposable,
  DspService,
  EffectDefinition,
  EffectParamValue,
  EffectSegment,
  PlayerService,
  SourcesService,
} from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { BUILTIN_EFFECTS, TempoPitchEffect } from './effects/index.js'
import { DSP_ROUTES } from './views.js'

export * from './effects/index.js'
export * from './views.js'

const STORE_CHAIN_KEY = 'dsp-chain'
const STORE_PARAMS_KEY = 'dsp-params'

export class DspPlugin extends Service implements DspService {
  static override readonly name = 'dsp'
  static readonly inject = ['audio', 'store']

  private readonly defs = new Map<string, EffectDefinition>()
  private chainEntries: ChainEntry[] = []
  private readonly paramsState = new Map<string, Record<string, unknown>>()
  private readonly activeSegments = new Map<string, EffectSegment>()
  private isRebuilding = false

  constructor(ctx: Context) {
    super(ctx, 'dsp')
  }

  async [Service.init]() {
    this.ctx.logger.info('plugin-dsp: initialized')

    // Register built-in effects
    for (const effect of BUILTIN_EFFECTS) {
      this.defs.set(effect.id, effect)
    }

    // Load persisted state
    try {
      const savedChain = await this.ctx.store.get<ChainEntry[]>(STORE_CHAIN_KEY)
      const savedParams = await this.ctx.store.get<Record<string, Record<string, unknown>>>(STORE_PARAMS_KEY)

      if (savedParams) {
        for (const [k, v] of Object.entries(savedParams)) {
          this.paramsState.set(k, { ...v })
        }
      }

      if (Array.isArray(savedChain) && savedChain.length > 0) {
        // Merge with registered definitions in case new effects exist
        const known = new Set(savedChain.map((c) => c.effectId))
        this.chainEntries = [...savedChain]
        for (const def of this.defs.values()) {
          if (!known.has(def.id)) {
            this.chainEntries.push({
              effectId: def.id,
              enabled: false,
              ordinal: def.defaultOrder,
            })
          }
        }
      } else {
        // Default initial chain
        this.chainEntries = [...this.defs.values()].map((def) => ({
          effectId: def.id,
          enabled: def.id === 'limiter', // Limiter enabled by default for protection
          ordinal: def.defaultOrder,
        }))
      }
    } catch (err) {
      this.ctx.logger.warn(`plugin-dsp: failed to load persisted chain: ${err}`)
      this.chainEntries = [...this.defs.values()].map((def) => ({
        effectId: def.id,
        enabled: def.id === 'limiter',
        ordinal: def.defaultOrder,
      }))
    }

    // Auto-disable hook for tempo-pitch when dropouts occur
    TempoPitchEffect.onSelfDisable = () => {
      this.ctx.logger.warn('plugin-dsp: tempo-pitch reported excessive dropouts; self-disabling to preserve chain')
      void this.setEnabled('tempo-pitch', false)
    }

    // Initial graph wiring without dipping volume during startup
    await this.rebuildGraph(false)

    // Contribute UI routes & settings if ctx.ui is available
    this.ctx.inject(['ui'], (scoped) =>
      scoped.effect(function* () {
        scoped.logger.debug(`plugin-dsp: contributing route ${DSP_ROUTES.main}`)
        yield scoped.ui.contribute({
          kind: 'route',
          id: DSP_ROUTES.main,
          path: '/dsp',
          title: '音频效果 (DSP)',
          icon: 'tune',
          placement: ['tray'],
          order: 65,
        })

        yield scoped.ui.contribute({
          kind: 'settings',
          id: DSP_ROUTES.normalizationSettings,
          section: 'playback',
          title: '曲目间音量响度标准化 (Loudness Normalization)',
          description: '基于 ReplayGain 与 EBU R128 标准自动平衡不同曲目的音量差异，防止忽大忽小',
          display: 'card',
          order: 25,
        })

        yield scoped.ui.contribute({
          kind: 'settings',
          id: DSP_ROUTES.settings,
          section: 'audio',
          title: '音频效果与均衡器 (DSP)',
          description: '10频段图示均衡器、动态压缩与空间混响调音面板',
          actionText: '打开音效面板 →',
          display: 'card',
          order: 30,
        })
      }, 'dsp-ui-contributions'),
    )

    // Observe track changes to apply dynamic ReplayGain loudness normalization
    let offTrackChanged: (() => void) | undefined
    this.ctx.inject(['player', 'sources'], (scoped) => {
      const off = scoped.on('player/track-changed', (trackUrn) => {
        void this.handleTrackChanged(trackUrn, scoped)
      })
      const initialPlayer = serviceOf<PlayerService>(scoped, 'player')
      if (initialPlayer?.state?.trackUrn) {
        void this.handleTrackChanged(initialPlayer.state.trackUrn, scoped)
      }
      offTrackChanged = off
      return () => {
        off()
        offTrackChanged = undefined
      }
    })

    // Sync with global settings if ctx.settings is present
    let offSettingsChanged: (() => void) | undefined
    this.ctx.inject(['settings'], (scoped) => {
      const syncFromSettings = (s: AppSettings) => {
        if (s.loudnessNormalizationEnabled !== undefined) {
          const entry = this.chainEntries.find((c) => c.effectId === 'normalize')
          if (entry && entry.enabled !== s.loudnessNormalizationEnabled) {
            void this.setEnabled('normalize', s.loudnessNormalizationEnabled)
          }
        }
        if (s.loudnessNormalizationMode !== undefined || s.loudnessTargetLufs !== undefined) {
          const current = this.getParams('normalize')
          let changed = false
          if (s.loudnessNormalizationMode && current['mode'] !== s.loudnessNormalizationMode) {
            current['mode'] = s.loudnessNormalizationMode
            changed = true
          }
          if (typeof s.loudnessTargetLufs === 'number' && current['targetLufs'] !== s.loudnessTargetLufs) {
            current['targetLufs'] = s.loudnessTargetLufs
            changed = true
          }
          if (changed) {
            this.paramsState.set('normalize', current)
            void this.persistState()
            this.emitChainChanged()
            const player = serviceOf<PlayerService>(this.ctx, 'player')
            const currentUrn = player?.state?.trackUrn
            if (currentUrn) {
              void this.handleTrackChanged(currentUrn, this.ctx)
            }
          }
        }
      }

      try {
        const s = typeof scoped.settings.getSync === 'function' ? scoped.settings.getSync() : undefined
        if (s) syncFromSettings(s)
      } catch {
        // ignore
      }

      const off = scoped.settings.onSettingsChange((s) => syncFromSettings(s))
      offSettingsChanged = off
      return () => {
        off()
        offSettingsChanged = undefined
      }
    })

    // Rebuild effect graph whenever audio backend changes or AudioContext is dynamically rebuilt
    const offEngine = this.ctx.on('audio/engine-changed', async () => {
      this.ctx.logger.info('plugin-dsp: audio engine changed, rebuilding DSP effect graph')
      await this.rebuildGraph(false)
    })

    const offContextRebuilt = this.ctx.on('audio/context-rebuilt', async () => {
      this.ctx.logger.info('plugin-dsp: audio context rebuilt, resplicing DSP graph')
      await this.rebuildGraph(false)
    })

    return () => {
      offTrackChanged?.()
      offSettingsChanged?.()
      offEngine()
      offContextRebuilt()
      for (const seg of this.activeSegments.values()) {
        try {
          seg.dispose()
        } catch {
          // ignore
        }
      }
      this.activeSegments.clear()
      try {
        this.ctx.audio.chainInput.disconnect()
        const chainOutput = (this.ctx.audio.chainOutput ?? this.ctx.audio.destination) as AudioNode
        this.ctx.audio.chainInput.connect(chainOutput)
      } catch {
        // ignore
      }
    }
  }

  register(def: EffectDefinition<never>): Disposable {
    this.defs.set(def.id, def as unknown as EffectDefinition)
    if (!this.chainEntries.some((c) => c.effectId === def.id)) {
      this.chainEntries.push({
        effectId: def.id,
        enabled: false,
        ordinal: def.defaultOrder,
      })
      this.chainEntries.sort((a, b) => a.ordinal - b.ordinal)
    }
    void this.rebuildGraph()

    return () => {
      this.defs.delete(def.id)
      this.chainEntries = this.chainEntries.filter((c) => c.effectId !== def.id)
      void this.rebuildGraph()
    }
  }

  get definitions(): readonly EffectDefinition<never>[] {
    return [...this.defs.values()] as unknown as EffectDefinition<never>[]
  }

  get chain(): readonly ChainEntry[] {
    return [...this.chainEntries].sort((a, b) => a.ordinal - b.ordinal)
  }

  get latencyMs(): number {
    let total = 0
    for (const seg of this.activeSegments.values()) {
      total += seg.latencyMs ?? 0
    }
    return total
  }

  getParams(effectId: string): Record<string, unknown> {
    const existing = this.paramsState.get(effectId)
    if (existing) return { ...existing }
    const def = this.defs.get(effectId)
    if (def?.presets && def.presets[0]) {
      return { ...(def.presets[0].params as Record<string, unknown>) }
    }
    return {}
  }

  async setEnabled(effectId: string, on: boolean): Promise<void> {
    const entry = this.chainEntries.find((c) => c.effectId === effectId)
    if (!entry || entry.enabled === on) return
    entry.enabled = on
    await this.persistState()
    await this.rebuildGraph()

    if (effectId === 'normalize') {
      try {
        const settings = serviceOf<{ update(patch: Partial<AppSettings>): Promise<unknown> }>(
          this.ctx,
          'settings',
        )
        if (typeof settings?.update === 'function') {
          void settings.update({ loudnessNormalizationEnabled: on })
        }
      } catch {
        // ignore
      }
      const player = serviceOf<PlayerService>(this.ctx, 'player')
      const sources = serviceOf<SourcesService>(this.ctx, 'sources')
      if (on && player && sources) {
        const currentUrn = player.state?.trackUrn
        if (currentUrn) {
          void this.handleTrackChanged(currentUrn, this.ctx)
        }
      }
    }
  }

  async setOrder(effectId: string, ordinal: number): Promise<void> {
    const entry = this.chainEntries.find((c) => c.effectId === effectId)
    if (!entry || entry.ordinal === ordinal) return
    entry.ordinal = ordinal
    this.chainEntries.sort((a, b) => a.ordinal - b.ordinal)
    await this.persistState()
    await this.rebuildGraph()
  }

  async setParam(effectId: string, name: string, value: EffectParamValue): Promise<void> {
    const current = this.paramsState.get(effectId) ?? {}
    current[name] = value
    this.paramsState.set(effectId, current)

    // Never rebuilds the graph — directly calls active segment with zero allocation and zero clicks
    const seg = this.activeSegments.get(effectId)
    if (seg) {
      seg.setParam(name, value)
    }

    await this.persistState()
    this.emitChainChanged()

    if (effectId === 'normalize' && name !== 'gainDb') {
      const player = serviceOf<PlayerService>(this.ctx, 'player')
      const sources = serviceOf<SourcesService>(this.ctx, 'sources')
      const currentUrn = player?.state?.trackUrn
      if (currentUrn && sources) {
        void this.handleTrackChanged(currentUrn, this.ctx)
      }
    }
  }

  /**
   * The enabled chain serialized for the native engine (mpv): each enabled
   * effect's lavfi adapter, in ordinal order. Effects without an adapter are
   * skipped — the WebAudio graph is their engine.
   */
  private composeAf(): string {
    const fragments: string[] = []
    for (const entry of [...this.chain].sort((a, b) => a.ordinal - b.ordinal)) {
      if (!entry.enabled) continue
      const fragment = this.defs.get(entry.effectId)?.buildLavfi?.(this.getParams(entry.effectId))
      if (fragment) fragments.push(fragment)
    }
    return fragments.join(',')
  }

  private emitChainChanged(): void {
    this.ctx.emit('dsp/chain-changed', this.chain)
    const normParams = this.getParams('normalize')
    const normEntry = this.chainEntries.find((c) => c.effectId === 'normalize')
    const normMode = (normParams['mode'] as string | undefined) ?? 'track'
    const replaygainMode = normEntry?.enabled
      ? normMode === 'album'
        ? 'album'
        : normMode === 'track'
          ? 'track'
          : 'no'
      : 'no'

    const targetLufs = typeof normParams['targetLufs'] === 'number' ? (normParams['targetLufs'] as number) : -14
    // ReplayGain reference is -18 LUFS (89 dB SPL).
    const lufsOffset = targetLufs - (-18)
    const preampDb = typeof normParams['preampDb'] === 'number' ? (normParams['preampDb'] as number) : 0
    const totalPreamp = lufsOffset + preampDb

    this.ctx.emit('dsp/af-changed', {
      af: this.composeAf(),
      replaygain: replaygainMode,
      replaygainClip: true,
      replaygainPreamp: String(totalPreamp),
      replaygainFallback: String(normParams['fallbackGainDb'] ?? '0'),
    })
  }

  async applyPreset(effectId: string, presetName: string): Promise<void> {
    const def = this.defs.get(effectId)
    if (!def?.presets) return
    const preset = def.presets.find((p) => p.name === presetName)
    if (!preset) return

    const params = preset.params as Record<string, EffectParamValue>
    const current = this.paramsState.get(effectId) ?? {}

    for (const [k, v] of Object.entries(params)) {
      current[k] = v
      const seg = this.activeSegments.get(effectId)
      if (seg) {
        seg.setParam(k, v)
      }
    }
    this.paramsState.set(effectId, current)
    await this.persistState()
    this.emitChainChanged()

    if (effectId === 'normalize') {
      const player = serviceOf<PlayerService>(this.ctx, 'player')
      const sources = serviceOf<SourcesService>(this.ctx, 'sources')
      const currentUrn = player?.state?.trackUrn
      if (currentUrn && sources) {
        void this.handleTrackChanged(currentUrn, this.ctx)
      }
    }
  }

  private async handleTrackChanged(trackUrn: string | undefined, scoped: Context): Promise<void> {
    const normEntry = this.chainEntries.find((c) => c.effectId === 'normalize')
    if (!normEntry || !normEntry.enabled) return

    const params = this.getParams('normalize')
    const mode = (params['mode'] as string | undefined) ?? 'track'
    if (mode === 'manual') return
    if (mode === 'loudnorm') {
      this.emitChainChanged()
      return
    }

    let appliedDb = typeof params['fallbackGainDb'] === 'number' ? (params['fallbackGainDb'] as number) : 0
    const sources = serviceOf<SourcesService>(scoped, 'sources')
    if (trackUrn && typeof sources?.getTracks === 'function') {
      try {
        const [track] = await sources.getTracks([trackUrn])
        if (track) {
          const rawGain =
            mode === 'album'
              ? track.replayGainAlbum ?? track.replayGainTrack
              : track.replayGainTrack
          if (typeof rawGain === 'number' && !Number.isNaN(rawGain)) {
            const targetLufs = typeof params['targetLufs'] === 'number' ? (params['targetLufs'] as number) : -14
            // ReplayGain 2.0 reference is -18 LUFS (89 dB SPL).
            const lufsOffset = targetLufs - (-18)
            const preamp = typeof params['preampDb'] === 'number' ? (params['preampDb'] as number) : 0
            appliedDb = rawGain + lufsOffset + preamp
          }
        }
      } catch (err) {
        this.ctx.logger.warn(`plugin-dsp: failed to resolve track replaygain for ${trackUrn}: ${err}`)
      }
    }

    const clampedDb = Math.max(-20, Math.min(20, Math.round(appliedDb * 10) / 10))
    this.ctx.logger.info(`plugin-dsp: applied replaygain normalize gain: ${clampedDb} dB (mode: ${mode})`)

    const seg = this.activeSegments.get('normalize')
    if (seg) {
      seg.setParam('gainDb', clampedDb)
    }

    const current = this.paramsState.get('normalize') ?? {}
    current['gainDb'] = clampedDb
    this.paramsState.set('normalize', current)

    this.emitChainChanged()
  }

  private async persistState(): Promise<void> {
    try {
      await this.ctx.store.set(STORE_CHAIN_KEY, this.chainEntries)
      const paramsObj: Record<string, Record<string, unknown>> = {}
      for (const [k, v] of this.paramsState.entries()) {
        paramsObj[k] = v
      }
      await this.ctx.store.set(STORE_PARAMS_KEY, paramsObj)
    } catch (err) {
      this.ctx.logger.warn(`plugin-dsp: failed to save state: ${err}`)
    }
  }

  /**
   * Spliced between chainInput and chainOutput.
   * Master volume dips smoothly to prevent any click during reconnection.
   */
  private async rebuildGraph(dip = true): Promise<void> {
    if (this.isRebuilding) return
    this.isRebuilding = true

    let restoreVolume: Disposable = () => {}
    try {
      // 20ms master gain dip to eliminate any clicks during runtime reconfiguration
      if (dip && typeof this.ctx.audio.dipVolume === 'function') {
        restoreVolume = await this.ctx.audio.dipVolume(20)
      }

      const chainInput = this.ctx.audio.chainInput
      const chainOutput = (this.ctx.audio.chainOutput ?? this.ctx.audio.destination) as AudioNode

      // Disconnect all active segments
      for (const seg of this.activeSegments.values()) {
        try {
          seg.dispose()
        } catch {
          // ignore
        }
      }
      this.activeSegments.clear()

      // Disconnect chainInput
      try {
        chainInput.disconnect()
      } catch {
        // ignore
      }

      // Collect enabled effects sorted by ordinal
      const sorted = [...this.chainEntries]
        .filter((c) => c.enabled && this.defs.has(c.effectId))
        .sort((a, b) => a.ordinal - b.ordinal)

      if (sorted.length === 0) {
        // Pass-through
        chainInput.connect(chainOutput)
      } else {
        const segments: EffectSegment[] = []
        for (const entry of sorted) {
          const def = this.defs.get(entry.effectId)!
          const params = this.getParams(entry.effectId)
          const seg = def.build(this.ctx.audio.context, params as never)
          this.activeSegments.set(entry.effectId, seg)
          segments.push(seg)
        }

        // Waterfall hook for other plugins to contribute or intercept segments
        const finalSegments = this.ctx.waterfall('dsp/build-chain', segments, () => segments)

        // Wire segments in series: chainInput -> seg[0].input ... seg[last].output -> chainOutput
        if (finalSegments.length > 0) {
          const first = finalSegments[0]
          const last = finalSegments[finalSegments.length - 1]
          if (first && last) {
            chainInput.connect(first.input)
            for (let i = 0; i < finalSegments.length - 1; i++) {
              const current = finalSegments[i]
              const next = finalSegments[i + 1]
              if (current && next) {
                current.output.connect(next.input)
              }
            }
            last.output.connect(chainOutput)
          }
        } else {
          chainInput.connect(chainOutput)
        }
      }

      this.emitChainChanged()
    } catch (err) {
      this.ctx.logger.error(`plugin-dsp: graph rebuild error: ${err}`)
    } finally {
      // Restore master volume ramp
      restoreVolume()
      this.isRebuilding = false
    }
  }
}

export const name = 'plugin-dsp'
export const inject = ['audio', 'store']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-dsp: loaded')
  const fiber = await ctx.plugin(DspPlugin)
  return () => void fiber.dispose()
}

export default { name, inject, apply }
