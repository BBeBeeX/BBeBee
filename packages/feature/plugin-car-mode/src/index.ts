/**
 * `plugin-car-mode` — driving-optimized mode.
 *
 * Owns exactly one thing: the `ctx.carMode` state machine — whether the mode
 * is on, what turned it on, and the two switches (`enabled`, `autoOnCharging`)
 * that govern it. Everything visual belongs to the view twins
 * (`plugin-car-mode-ui-mobile` and, later, a desktop one), which reach the
 * state through the service and the `car-mode/changed` event.
 *
 * A **trigger-scoped** state machine, deliberately: `deactivate(trigger)`
 * only lands when it names the trigger that activated the mode, so a charging
 * cable being pulled at a red light must never kill the car mode the driver
 * turned on by hand. `activate` may *take over* the trigger while active —
 * the latest reason for driving wins — but nothing but the matching
 * `deactivate`, the master switch, or the plugin unloading can end the mode.
 *
 * The integrations (haptics, the charging proxy of "docked in the car",
 * persistence) are all optional `ctx.inject` blocks, so the desktop shell —
 * which has none of them — loads this plugin headless and silent.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { CarModeService, CarModeTrigger, HapticsService, StoreService } from '@BBeBee/protocol'
import type {} from '@BBeBee/protocol'
import { CAR_MODE_ROUTES } from './views.js'

const STORE_KEY = 'car-mode.config'

/** The persisted slice — two booleans, restored as-is on load. */
interface CarModeConfig {
  enabled: boolean
  autoOnCharging: boolean
}

const DEFAULT_CONFIG: CarModeConfig = { enabled: true, autoOnCharging: false }

export class CarMode extends Service implements CarModeService {
  static readonly inject = []

  private config: CarModeConfig = { ...DEFAULT_CONFIG }
  private isActive = false
  private currentTrigger: CarModeTrigger | undefined
  /**
   * The last charging state `device.battery()` reported, so "charging" can be
   * told apart from "stopped charging". `undefined` until the first read —
   * a platform with no battery (a desktop, a test) never sets it.
   */
  private lastCharging: boolean | undefined
  /** Set while an optional `haptics` service is loaded; the inject clears it. */
  private haptics: HapticsService | undefined

  constructor(ctx: Context) {
    super(ctx, 'carMode')

    // Restore the persisted switches. Optional: without a store the mode
    // simply starts from defaults on every launch.
    this.ctx.inject(['store'], (scoped) => {
      void scoped.store
        .get<Partial<CarModeConfig>>(STORE_KEY)
        .then((stored) => {
          if (typeof stored?.enabled === 'boolean') this.config.enabled = stored.enabled
          if (typeof stored?.autoOnCharging === 'boolean') {
            this.config.autoOnCharging = stored.autoOnCharging
          }
        })
        .catch((error) => {
          scoped.logger.warn(`car-mode: failed to restore config: ${error}`)
        })
    })

    // The activation cue. Optional: the desktop shell runs this plugin with
    // no haptics service, and the optional chain below is the whole guard.
    this.ctx.inject(['haptics'], (scoped) => {
      this.haptics = scoped.haptics
      return () => {
        this.haptics = undefined
      }
    })

    // "Docked in the car", by proxy: RN cannot see the Android car-dock
    // broadcast or CarPlay's connection without native code, but a charging
    // flip while the app comes forward is the same event in practice. The
    // listener rides the *device* inject — no battery to read means nothing
    // to watch — and the phase event is what prompts the read, because
    // polling a battery is waste and a push API does not exist.
    this.ctx.inject(['device'], (scoped) => {
      const off = scoped.on('lifecycle/phase-changed', (phase) => {
        if (phase !== 'active') return
        void scoped.device
          .battery()
          .then((battery) => {
            if (!battery) return
            const previous = this.lastCharging
            this.lastCharging = battery.charging
            if (!this.config.autoOnCharging) return
            // The first read counts as a flip onto the charger: launching
            // already docked enters car mode exactly as plugging in mid-drive
            // does. Leaving the charger only ends a mode the charger started.
            if (battery.charging && previous !== true) this.activate('charging')
            else if (!battery.charging && previous === true) this.deactivate('charging')
          })
          .catch((error) => {
            scoped.logger.warn(`car-mode: battery read failed: ${error}`)
          })
      })
      return () => off()
    })
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  get active(): boolean {
    return this.isActive
  }

  get trigger(): CarModeTrigger | undefined {
    return this.currentTrigger
  }

  get autoOnCharging(): boolean {
    return this.config.autoOnCharging
  }

  setEnabled(on: boolean): void {
    if (on === this.config.enabled) return
    this.config.enabled = on
    this.ctx.logger.info(`car-mode: ${on ? 'enabled' : 'disabled'}`)
    this.persist()
    // The master switch is authoritative: turning it off while the mode is on
    // ends the mode whatever started it.
    if (!on && this.isActive) this.deactivateInternal()
  }

  setAutoOnCharging(on: boolean): void {
    if (on === this.config.autoOnCharging) return
    this.config.autoOnCharging = on
    this.ctx.logger.info(`car-mode: auto-on-charging ${on ? 'on' : 'off'}`)
    this.persist()
  }

  activate(trigger: CarModeTrigger): void {
    if (!this.config.enabled) {
      this.ctx.logger.warn(`car-mode: activate(${trigger}) ignored — car mode is disabled`)
      return
    }
    if (this.isActive && trigger === this.currentTrigger) return
    const previous = this.currentTrigger
    const wasActive = this.isActive
    this.isActive = true
    this.currentTrigger = trigger
    if (wasActive) {
      this.ctx.logger.info(`car-mode: trigger taken over — ${String(previous)} → ${trigger}`)
    } else {
      this.ctx.logger.info(`car-mode: activated (${trigger})`)
      this.haptics?.notification('success')
    }
    // The trigger is part of the visible state (the event carries it), so a
    // take-over re-emits with the new pair; a no-change call never emits.
    this.ctx.emit('car-mode/changed', true, trigger)
  }

  deactivate(trigger: CarModeTrigger): void {
    if (!this.isActive) return
    if (trigger !== this.currentTrigger) {
      this.ctx.logger.debug(
        `car-mode: deactivate(${trigger}) ignored — active trigger is ${String(this.currentTrigger)}`,
      )
      return
    }
    this.deactivateInternal()
  }

  private deactivateInternal(): void {
    const trigger = this.currentTrigger
    this.isActive = false
    this.currentTrigger = undefined
    this.ctx.logger.info(`car-mode: deactivated (was ${String(trigger)})`)
    this.ctx.emit('car-mode/changed', false, undefined)
  }

  /**
   * Write the two switches through, when a store exists. Resolved per write
   * via `reflect` rather than cached from the restore inject — the store may
   * unload between writes, and a stale proxy would throw long after the
   * caller stopped caring.
   */
  private persist(): void {
    const store = (
      this.ctx as unknown as { reflect?: { get(k: string, req: boolean): unknown } }
    ).reflect?.get('store', false) as StoreService | undefined
    if (!store) return
    void store.set(STORE_KEY, this.config).catch((error) => {
      this.ctx.logger.warn(`car-mode: failed to persist config: ${error}`)
    })
  }
}

export const name = 'plugin-car-mode'

/**
 * Loads the service and contributes the route. The service is awaited —
 * `ctx.carMode` is the plugin's whole point — while the `ui` inject is a
 * child fiber, not awaited: a build without `plugin-ui` is a build with no
 * contribution, not a plugin that never finishes loading.
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-car-mode: loaded')

  const serviceFiber = await ctx.plugin(CarMode)

  const uiFiber = ctx.inject(['ui'], (scoped) =>
    scoped.effect(function* () {
      scoped.logger.debug(`car-mode: contributing route ${CAR_MODE_ROUTES.carMode}`)
      yield scoped.ui.contribute({
        kind: 'route',
        id: CAR_MODE_ROUTES.carMode,
        path: '/car-mode',
        title: 'Car mode',
        icon: 'car',
        // Tray only: car mode is a mode you enter and leave, not a place you
        // browse to — no tab (mobile's tab bar is a fixed four anyway) and no
        // sidebar slot. The mobile entrance is the settings link row the view
        // twin contributes, plus auto-activation's navigation.
        placement: ['tray'],
        order: 26,
      })
    }, 'car-mode-ui-contributions'),
  )

  return () => {
    uiFiber.dispose()
    serviceFiber.dispose()
  }
}

export default { name, apply }
