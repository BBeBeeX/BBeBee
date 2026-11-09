/**
 * Reactive view hooks for `ctx.updater`.
 */

import { useState, useEffect, useCallback } from 'react'
import type { Context } from '@BBeBee/kernel'
import type {
  UpdateCheckResult,
  UpdaterConfig,
  UpdaterService,
  UpdaterStatus,
} from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/toolkit/hooks'

const DEFAULT_CONFIG: UpdaterConfig = {
  channel: 'main',
  githubRepo: 'BBeBee/BBeBee',
  autoCheck: true,
  checkIntervalMs: 24 * 60 * 60 * 1000,
  autoApplyHotUpdate: false,
}

/**
 * Returns current updater status and configuration.
 */
export function useUpdater(ctx: Context): {
  status: UpdaterStatus
  config: UpdaterConfig
  service: UpdaterService | undefined
} {
  const service = serviceOf<UpdaterService>(ctx, 'updater')

  const status = useServiceState<UpdaterStatus>(
    ctx,
    ['updater/status-changed'],
    () => service?.status ?? 'idle',
  )

  const config = useServiceState<UpdaterConfig>(
    ctx,
    ['updater/status-changed', 'settings/changed'],
    () => service?.config ?? DEFAULT_CONFIG,
  )

  return { status, config, service }
}

/**
 * Reactive update-checker hook.
 */
export function useUpdateCheck(ctx: Context): {
  checking: boolean
  result: UpdateCheckResult | undefined
  checkNow: () => Promise<UpdateCheckResult | undefined>
} {
  const { service, status } = useUpdater(ctx)
  const [result, setResult] = useState<UpdateCheckResult | undefined>()

  useEffect(() => {
    if (!ctx) return
    const off = ctx.on('updater/available', (res) => {
      setResult(res)
    })
    return () => {
      off()
    }
  }, [ctx])

  const checkNow = useCallback(async () => {
    if (!service) return undefined
    const res = await service.checkUpdate({ force: true })
    setResult(res)
    return res
  }, [service])

  return {
    checking: status === 'checking',
    result,
    checkNow,
  }
}
