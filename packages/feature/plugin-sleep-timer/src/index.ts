/**
 * `plugin-sleep-timer` — stops playback after a duration, at a specific time,
 * or when the current track finishes.
 *
 * Layer 4. Reaches the platform only through `ctx.player` and `ctx.logger`.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  SleepTimerService,
  SleepTimerState,
} from '@BBeBee/protocol'

export class SleepTimer extends Service implements SleepTimerService {
  static inject = ['player']

  private readonly ownCtx: Context
  private _state: SleepTimerState = { active: false }
  private timer: ReturnType<typeof setTimeout> | undefined
  private offListeners?: () => void

  constructor(ctx: Context) {
    super(ctx, 'sleepTimer')
    this.ownCtx = ctx
  }

  [Service.init]() {
    return () => {
      this.cancel()
    }
  }

  get state(): SleepTimerState {
    return this._state
  }

  startDuration(ms: number): void {
    this.clearTimers()
    if (ms <= 0) {
      this.fire()
      return
    }

    const targetEpochMs = Date.now() + ms
    this._state = {
      active: true,
      mode: 'duration',
      targetEpochMs,
      durationMs: ms,
    }
    this.ownCtx.logger.info('sleep-timer: started duration of %d ms (target: %d)', ms, targetEpochMs)

    this.timer = setTimeout(() => {
      this.fire()
    }, ms)

    this.ownCtx.emit('sleep-timer/changed', this._state)
  }

  startAtEpoch(epochMs: number): void {
    this.clearTimers()
    const ms = epochMs - Date.now()
    if (ms <= 0) {
      this.fire()
      return
    }

    this._state = {
      active: true,
      mode: 'epoch',
      targetEpochMs: epochMs,
      durationMs: ms,
    }
    this.ownCtx.logger.info('sleep-timer: scheduled at epoch %d (%d ms from now)', epochMs, ms)

    this.timer = setTimeout(() => {
      this.fire()
    }, ms)

    this.ownCtx.emit('sleep-timer/changed', this._state)
  }

  startEndOfTrack(): void {
    this.clearTimers()
    this._state = {
      active: true,
      mode: 'end-of-track',
    }
    this.ownCtx.logger.info('sleep-timer: waiting for end of track')

    const offCompleted = this.ownCtx.on('player/track-completed', () => {
      if (this._state.active && this._state.mode === 'end-of-track') {
        this.fire()
      }
    })

    const offState = this.ownCtx.on('player/state-changed', (state) => {
      if (this._state.active && this._state.mode === 'end-of-track' && state.status === 'idle') {
        this.fire()
      }
    })

    this.offListeners = () => {
      offCompleted()
      offState()
    }

    this.ownCtx.emit('sleep-timer/changed', this._state)
  }

  cancel(): void {
    this.clearTimers()
    if (this._state.active) {
      this._state = { active: false }
      this.ownCtx.logger.info('sleep-timer: cancelled')
      this.ownCtx.emit('sleep-timer/changed', this._state)
    }
  }

  private clearTimers(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.offListeners) {
      this.offListeners()
      this.offListeners = undefined
    }
  }

  private fire(): void {
    this.clearTimers()
    this._state = { active: false }
    this.ownCtx.logger.info('sleep-timer: timer fired, pausing player')
    try {
      this.ownCtx.player.pause()
    } catch (e) {
      this.ownCtx.logger.warn(`sleep-timer: could not pause player: ${String(e)}`)
    }
    this.ownCtx.emit('sleep-timer/changed', this._state)
    this.ownCtx.emit('sleep-timer/fired')
  }
}

export const name = 'plugin-sleep-timer'
export const inject = ['player']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-sleep-timer: loaded')
  const fiber = await ctx.plugin(SleepTimer)
  return () => void fiber.dispose()
}

export default { name, apply }
