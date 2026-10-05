import { useCallback, useEffect, useState } from 'react'
import type { Context } from '@BBeBee/kernel'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import type {
  ChainEntry,
  DspService,
  EffectDefinition,
  EffectParamValue,
} from '@BBeBee/protocol'

export interface UseDspResult {
  chain: readonly ChainEntry[]
  definitions: readonly EffectDefinition[]
  latencyMs: number
  setEnabled: (effectId: string, on: boolean) => Promise<void>
  setOrder: (effectId: string, ordinal: number) => Promise<void>
  setParam: (effectId: string, name: string, value: EffectParamValue) => Promise<void>
  applyPreset: (effectId: string, presetName: string) => Promise<void>
  getParams: (effectId: string) => Record<string, unknown>
}

export function useDsp(ctx: Context): UseDspResult {
  const dsp = serviceOf<DspService>(ctx, 'dsp')

  const [chain, setChain] = useState<readonly ChainEntry[]>(() => (dsp ? dsp.chain : []))
  const [latencyMs, setLatencyMs] = useState<number>(() => (dsp ? dsp.latencyMs : 0))
  const [definitions, setDefinitions] = useState<readonly EffectDefinition[]>(() =>
    dsp ? dsp.definitions : [],
  )

  const refresh = useCallback(() => {
    const service = serviceOf<DspService>(ctx, 'dsp')
    if (service) {
      setChain([...service.chain])
      setLatencyMs(service.latencyMs)
      setDefinitions([...service.definitions])
    }
  }, [ctx])

  useEffect(() => {
    refresh()
    const off1 = ctx.on('dsp/chain-changed', () => {
      refresh()
    })
    const untypedCtx = ctx as { on?: (event: string, cb: (name: unknown) => void) => () => void }
    const off2 = untypedCtx.on?.('internal/service', (name: unknown) => {
      if (name === 'dsp') refresh()
    })
    return () => {
      void off1()
      if (typeof off2 === 'function') void off2()
    }
  }, [ctx, refresh])

  const setEnabled = useCallback(
    async (effectId: string, on: boolean) => {
      const service = serviceOf<DspService>(ctx, 'dsp')
      if (service) {
        await service.setEnabled(effectId, on)
        refresh()
      }
    },
    [ctx, refresh],
  )

  const setOrder = useCallback(
    async (effectId: string, ordinal: number) => {
      const service = serviceOf<DspService>(ctx, 'dsp')
      if (service) {
        await service.setOrder(effectId, ordinal)
        refresh()
      }
    },
    [ctx, refresh],
  )

  const setParam = useCallback(
    async (effectId: string, name: string, value: EffectParamValue) => {
      const service = serviceOf<DspService>(ctx, 'dsp')
      if (service) {
        await service.setParam(effectId, name, value)
        refresh()
      }
    },
    [ctx, refresh],
  )

  const applyPreset = useCallback(
    async (effectId: string, presetName: string) => {
      const service = serviceOf<DspService>(ctx, 'dsp')
      if (service) {
        await service.applyPreset(effectId, presetName)
        refresh()
      }
    },
    [ctx, refresh],
  )

  const getParams = useCallback(
    (effectId: string): Record<string, unknown> => {
      const service = serviceOf<DspService>(ctx, 'dsp')
      if (service && typeof service.getParams === 'function') {
        return service.getParams(effectId)
      }
      return {}
    },
    [ctx],
  )

  return {
    chain,
    definitions,
    latencyMs,
    setEnabled,
    setOrder,
    setParam,
    applyPreset,
    getParams,
  }
}

export interface UseDspEffectResult {
  entry?: ChainEntry
  definition?: EffectDefinition
  params: Record<string, unknown>
  setEnabled: (on: boolean) => Promise<void>
  setParam: (name: string, value: EffectParamValue) => Promise<void>
  applyPreset: (presetName: string) => Promise<void>
}

export function useDspEffect(ctx: Context, effectId: string): UseDspEffectResult {
  const { chain, definitions, setEnabled: setChainEnabled, setParam: setChainParam, applyPreset: applyChainPreset, getParams } =
    useDsp(ctx)

  const entry = chain.find((c) => c.effectId === effectId)
  const definition = definitions.find((d) => d.id === effectId)
  const params = getParams(effectId)

  const setEnabled = useCallback(
    async (on: boolean) => {
      await setChainEnabled(effectId, on)
    },
    [effectId, setChainEnabled],
  )

  const setParam = useCallback(
    async (name: string, value: EffectParamValue) => {
      await setChainParam(effectId, name, value)
    },
    [effectId, setChainParam],
  )

  const applyPreset = useCallback(
    async (presetName: string) => {
      await applyChainPreset(effectId, presetName)
    },
    [effectId, applyChainPreset],
  )

  return {
    entry,
    definition,
    params,
    setEnabled,
    setParam,
    applyPreset,
  }
}
