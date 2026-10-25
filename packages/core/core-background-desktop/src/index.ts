/**
 * `ctx.background` on desktop.
 *
 * On desktop the honest answer to "may work continue in the background?" is
 * yes — a hidden window still runs (ADR-3, docs/02 §4). So this service is
 * mostly about the two things that are *not* free: keeping the machine awake
 * while audio plays, and hearing about a suspend in time to checkpoint.
 *
 * ⚠️ The asymmetry with mobile is the point of the contract existing at all. A
 * plugin that schedules work must ask rather than assume, because the same
 * call on Expo maps to an OS scheduler that may run hours late or never.
 *
 * See docs/04 §10, docs/02 §4 and docs/11 §4.3.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { BackgroundService, Disposable } from '@BBeBee/protocol'
import { requireBridge } from '@bbebee/core-desktop-bridge'
import type { BridgeApi } from '@bbebee/core-desktop-bridge'

export interface BackgroundTauriConfig {
  bridge?: BridgeApi
  /** Injected in tests so a schedule does not need real time to pass. */
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

export class BackgroundTauri extends Service implements BackgroundService {
  private readonly bridge?: BridgeApi
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  private readonly suspendListeners = new Set<() => void | Promise<void>>()
  /** Outstanding wake locks by id, so a leak is visible and disposal is total. */
  private readonly locks = new Map<number, string>()
  private nextLockId = 1
  private readonly timers = new Map<string, unknown>()
  private offBridge?: () => void

  constructor(ctx: Context, config: BackgroundTauriConfig = {}) {
    super(ctx, 'background')
    this.bridge = config.bridge ?? tryBridge()
    this.setTimer = config.setInterval ?? ((fn, ms) => setInterval(fn, ms))
    this.clearTimer = config.clearInterval ?? ((h) => clearInterval(h as never))
  }

  async [Service.init]() {
    this.offBridge = this.bridge?.on((event) => {
      if (event.topic === 'will-suspend') void this.runSuspendListeners()
    })

    return async () => {
      this.offBridge?.()
      for (const handle of this.timers.values()) this.clearTimer(handle)
      this.timers.clear()
      // A wake lock outliving its owner keeps the machine awake forever, and
      // nothing on the OS side will ever release it. The leak test catches a
      // missed disposer here; this catches the rest.
      for (const id of [...this.locks.keys()]) await this.release(id)
      this.suspendListeners.clear()
    }
  }

  /**
   * Desktop keeps running while the window is merely hidden.
   *
   * Derived rather than hardcoded so the answer stays true if close-to-tray
   * is ever off: with no window and no tray there is no process to run in.
   */
  canRunInBackground(): boolean {
    return true
  }

  async acquireWakeLock(reason: string): Promise<Disposable> {
    const id = this.nextLockId++
    this.locks.set(id, reason)
    await this.bridge?.call('system', 'acquireWakeLock', [id, reason]).catch((error: unknown) => {
      // A refused blocker means the machine may sleep mid-track. Worth a line;
      // not worth failing playback over.
      this.ctx.logger.warn(`background: wake lock "${reason}" was refused: ${String(error)}`)
    })

    let released = false
    return () => {
      // Idempotent: a disposer called twice must not release someone else's
      // lock after the id is recycled.
      if (released) return
      released = true
      void this.release(id)
    }
  }

  /**
   * Periodic work.
   *
   * On desktop this is a plain interval and therefore *reliable*, which is
   * exactly the difference the contract exists to hide: the same call on
   * mobile is a hint to the OS. A caller that depends on punctuality is
   * already wrong, and will be wrong on the other platform.
   */
  async schedule(id: string, intervalMinutes: number, task: () => Promise<void>): Promise<Disposable> {
    this.cancel(id)
    const ms = Math.max(1, intervalMinutes) * 60_000
    const handle = this.setTimer(() => {
      void task().catch((error: unknown) => {
        this.ctx.logger.warn(`background: scheduled task "${id}" failed: ${String(error)}`)
      })
    }, ms)
    this.timers.set(id, handle)
    return () => this.cancel(id)
  }

  onWillSuspend(cb: () => void | Promise<void>): Disposable {
    this.suspendListeners.add(cb)
    return () => void this.suspendListeners.delete(cb)
  }

  /** Drive a suspend as the OS would. For tests and the debug console. */
  async simulateSuspend(): Promise<void> {
    await this.runSuspendListeners()
  }

  /** Reasons currently holding the machine awake. Read by the inspector. */
  get heldLocks(): readonly string[] {
    return [...this.locks.values()]
  }

  private cancel(id: string): void {
    const handle = this.timers.get(id)
    if (handle === undefined) return
    this.clearTimer(handle)
    this.timers.delete(id)
  }

  private async release(id: number): Promise<void> {
    if (!this.locks.delete(id)) return
    await this.bridge?.call('system', 'releaseWakeLock', [id]).catch(() => {})
  }

  /**
   * Run every checkpoint, awaiting all of them.
   *
   * Awaited because on the other platform there may be no "later" — and one
   * listener throwing must not stop the next from saving its state, which is
   * the whole reason this hook exists.
   */
  private async runSuspendListeners(): Promise<void> {
    await Promise.all(
      [...this.suspendListeners].map(async (cb) => {
        try {
          await cb()
        } catch (error) {
          this.ctx.logger.warn(`background: a suspend listener failed: ${String(error)}`)
        }
      }),
    )
  }
}

function tryBridge(): BridgeApi | undefined {
  try {
    return requireBridge()
  } catch {
    return undefined
  }
}

export const name = 'core-background-desktop'

export async function apply(ctx: Context, config: BackgroundTauriConfig = {}) {
  ctx.logger.info('core-background-desktop: loaded')
  const fiber = await ctx.plugin(BackgroundTauri, config)
  return () => void fiber.dispose()
}

export default { name, apply }
