/**
 * Reactive view hooks for `ctx.sleepTimer`.
 */

import type { Context } from 'cordis'
import type { SleepTimerService, SleepTimerState } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/toolkit/hooks'

const IDLE_STATE: SleepTimerState = { active: false }

/** The current sleep timer state, updated on any change or timer firing. */
export function useSleepTimer(ctx: Context): SleepTimerState {
  return useServiceState(
    ctx,
    ['sleep-timer/changed', 'sleep-timer/fired'],
    () => serviceOf<SleepTimerService>(ctx, 'sleepTimer')?.state ?? IDLE_STATE,
  )
}
