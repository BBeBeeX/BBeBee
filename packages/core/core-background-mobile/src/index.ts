/**
 * `ctx.background` on iOS and Android.
 *
 * Three unrelated promises, kept by three unrelated mechanisms:
 *
 * - **`canRunInBackground()`** — derived, never hardcoded (docs/11 §4.3). On
 *   mobile it is true only while the audio session is active, because that is
 *   literally what buys the process time: iOS keeps an app scheduled for
 *   `UIBackgroundModes: audio` and Android keeps it alive for a foreground
 *   media service. With no audio playing, the honest answer is `false`, and
 *   the UI says so rather than showing a progress bar that will stall.
 * - **`acquireWakeLock`** — `expo-keep-awake`, which maps to
 *   `FLAG_KEEP_SCREEN_ON` / `isIdleTimerDisabled`.
 * - **`schedule`** — `expo-background-task`, the OS scheduler. The interval is
 *   a hint; a run may be hours late or never happen, and the contract already
 *   says so. Because the OS dispatcher only fires when the app is *away*, a
 *   schedule would never run while the app is open at all — the scanner's
 *   auto-rescan would silently become desktop-only — so the service also runs
 *   due tasks when `AppState` reports the app back in the foreground. One
 *   due-ness check deduplicates the two dispatchers (see `runScheduled`).
 *
 * `onWillSuspend` is `AppState`, which is the only signal either platform
 * gives before the process stops being scheduled. It has to actually fire —
 * the player checkpoints its position on it, and everything downstream trusts
 * it (docs/11 §4.3).
 *
 * See docs/04 §12, docs/11 §4.3 and docs/services/contracts.md §9.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as BackgroundTask from 'expo-background-task'
import * as TaskManager from 'expo-task-manager'
import { AudioManager } from 'react-native-audio-api'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { BackgroundService, Disposable } from '@BBeBee/protocol'

export interface BackgroundExpoConfig {
  /**
   * The audio session category to claim while playing.
   *
   * `playback` is what keeps the process alive with the screen off, and is why
   * `canRunInBackground()` can ever be true. Anything else is a different app.
   */
  iosCategory?: 'playback' | 'ambient' | 'soloAmbient'
  /** Injected in tests, so due-ness does not need real time to pass. */
  now?: () => number
}

/** One registered periodic task, with the bookkeeping the dedup needs. */
interface ScheduledTask {
  run: () => Promise<void>
  /** Mirrors the desktop timer: `Math.max(1, intervalMinutes) * 60_000`. */
  intervalMs: number
  /**
   * When this task last fired. The next window opens a full `intervalMs`
   * later, which is what keeps an OS wake-up and a foreground resume from
   * running the same window twice.
   */
  lastRun: number
}

export class BackgroundExpo extends Service implements BackgroundService {
  private readonly suspendListeners = new Set<() => void | Promise<void>>()
  private readonly wakeLocks = new Set<string>()
  private readonly tasks = new Map<string, ScheduledTask>()

  private appStateSubscription?: NativeEventSubscription
  private lastAppState: AppStateStatus = AppState.currentState
  /** Set by `setSessionActive`, which the audio engine calls as it starts. */
  private sessionActive = false
  private readonly now: () => number

  constructor(ctx: Context, private readonly config: BackgroundExpoConfig = {}) {
    super(ctx, 'background')
    this.now = config.now ?? (() => Date.now())
  }

  /**
   * Tell this service that audio is (or is not) holding the process.
   *
   * Called by the shell when it starts and stops the audio session, because
   * only the shell owns that. Without it `canRunInBackground()` would have to
   * guess, and a hardcoded `true` is precisely the lie docs/11 §4.3 forbids.
   */
  setSessionActive(active: boolean): void {
    this.sessionActive = active
  }

  canRunInBackground(): boolean {
    return this.sessionActive
  }

  async acquireWakeLock(reason: string): Promise<Disposable> {
    // Keyed, so two holders do not release each other's lock — and so a leak
    // is visible as a non-empty set rather than as a device that never sleeps.
    const id = `${reason}-${Math.random().toString(36).slice(2, 10)}`
    this.wakeLocks.add(id)
    try {
      await activateKeepAwakeAsync(id)
    } catch {
      // A build without the module linked. The caller's work still runs; it
      // may simply be suspended sooner.
    }

    let released = false
    return () => {
      if (released) return
      released = true
      this.wakeLocks.delete(id)
      try {
        deactivateKeepAwake(id)
      } catch {
        /* nothing to release */
      }
    }
  }

  /**
   * Register deferrable periodic work.
   *
   * The task body is held here and dispatched by a single registered
   * TaskManager entry, because `TaskManager.defineTask` is a *module-level*
   * registration that survives the fiber that made it — defining one per
   * caller would leak a native registration every time a plugin reloaded.
   */
  async schedule(id: string, intervalMinutes: number, task: () => Promise<void>): Promise<Disposable> {
    // `lastRun` starts at *now*, mirroring the desktop timer: `setInterval`
    // fires a full interval after scheduling, not immediately. A foreground
    // resume one minute after boot therefore runs nothing a desktop build
    // would not have run either.
    this.tasks.set(id, {
      run: task,
      intervalMs: Math.max(1, intervalMinutes) * 60_000,
      lastRun: this.now(),
    })
    defineDispatcher(this)

    try {
      await BackgroundTask.registerTaskAsync(DISPATCH_TASK, {
        minimumInterval: Math.max(1, Math.round(intervalMinutes)),
      })
    } catch {
      // Background execution refused — Low Power Mode, a restricted user, a
      // simulator. The task simply never runs in the background; a foreground
      // caller can still invoke it.
    }

    return () => {
      this.tasks.delete(id)
      if (this.tasks.size === 0) {
        void BackgroundTask.unregisterTaskAsync(DISPATCH_TASK).catch(() => undefined)
      }
    }
  }

  /**
   * Run every scheduled task that is **due**, called by the OS dispatcher and
   * by the foreground-resume listener alike.
   *
   * The two dispatchers share this method, so due-ness *is* the dedup: each
   * task carries the time it last fired, and a window fires at most once no
   * matter how many wake-ups land in it. Without that, the OS could run a
   * task in the background and the user would run it again simply by opening
   * the app before the next interval elapsed — and every 'active' transition
   * would re-fire it, which is how a scanner ends up scanning on every
   * app-switch.
   *
   * Desktop needs none of this — its schedule is one timer, and a timer
   * cannot double-fire — which is exactly the asymmetry the contract warns
   * about. `lastRun` is stamped *before* the task is awaited, so two
   * wake-ups arriving while a long task runs still cannot both start it.
   */
  async runScheduled(): Promise<void> {
    const now = this.now()
    for (const entry of [...this.tasks.values()]) {
      if (now - entry.lastRun < entry.intervalMs) continue
      entry.lastRun = now
      // One failing task must not stop the others: they are unrelated
      // subscribers to the same wake-up.
      await entry.run().catch(() => undefined)
    }
  }

  onWillSuspend(cb: () => void | Promise<void>): Disposable {
    this.suspendListeners.add(cb)
    // The AppState subscription itself is owned by `[Service.init]` — it also
    // drives the foreground-resume tick, which must exist even when nobody
    // registers a suspend listener.
    return () => {
      this.suspendListeners.delete(cb)
    }
  }

  /**
   * The transition, not the state — in both directions.
   *
   * `active` → anything else fires the suspend listeners once, on the way
   * out; listening for the state would re-fire on every subsequent event
   * while still backgrounded, and the player would checkpoint repeatedly for
   * no reason. Anything else → `active` runs the due scheduled tasks, because
   * the OS scheduler never fires while the app is open and a run it owed may
   * be hours late or skipped outright (Low Power Mode, iOS overnight policy).
   */
  private onAppStateChange(next: AppStateStatus): void {
    const previous = this.lastAppState
    this.lastAppState = next

    if (previous === 'active' && next !== 'active') {
      for (const listener of [...this.suspendListeners]) {
        try {
          void listener()
        } catch {
          /* a checkpoint that throws must not stop the others */
        }
      }
      return
    }

    if (next === 'active' && previous !== 'active') {
      // Due-ness is checked inside `runScheduled`, so a transition that is
      // not really a resume — iOS's `inactive` bounce through the app
      // switcher, a control-centre visit — costs a pass over the map and
      // nothing more. Never awaited: this is the OS's cue, not the caller's
      // checkpoint, and each task reports its own failures.
      void this.runScheduled()
    }
  }

  async [Service.init]() {
    /*
     * The audio session category, claimed once at boot.
     *
     * This is the half of "playback survives backgrounding" that no amount of
     * JavaScript can substitute for: without `playback`, iOS suspends the
     * process the moment the screen locks (docs/11 §4.13).
     */
    try {
      AudioManager.setAudioSessionOptions({
        iosCategory: this.config.iosCategory ?? 'playback',
        iosMode: 'default',
        iosOptions: ['allowAirPlay', 'allowBluetoothA2DP'],
      })
    } catch {
      /* not linked in this build */
    }

    /*
     * One `AppState` listener for the service's whole lifetime, serving both
     * of the concerns this service has: checkpointing on the way out
     * (`onWillSuspend`) and running due periodic work on the way back in.
     *
     * The old shape subscribed lazily — only while a suspend listener was
     * registered — which was right when `AppState` had one job. It has two
     * now: the foreground tick belongs to the *service*, not to whoever
     * happens to have called `onWillSuspend`, so the subscription may not
     * disappear just because the last suspend listener was disposed.
     */
    this.lastAppState = AppState.currentState
    this.appStateSubscription = AppState.addEventListener('change', (next) => {
      this.onAppStateChange(next)
    })

    return () => {
      this.appStateSubscription?.remove()
      this.appStateSubscription = undefined
      this.suspendListeners.clear()
      // A leaked keep-awake is a device that never sleeps with nothing left
      // to release it — the one leak here with a user-visible cost.
      for (const id of this.wakeLocks) {
        try {
          deactivateKeepAwake(id)
        } catch {
          /* already gone */
        }
      }
      this.wakeLocks.clear()
      this.tasks.clear()
      // The module-level dispatcher outlives the fiber — `defineTask` is a
      // registration the OS keeps. Left pointing here, a wake-up after this
      // service was disposed would run tasks belonging to a torn-down graph.
      releaseDispatcher(this)
      void BackgroundTask.unregisterTaskAsync(DISPATCH_TASK).catch(() => undefined)
    }
  }
}

/** One OS task for every caller, because `defineTask` outlives a fiber. */
const DISPATCH_TASK = 'bbebee.background.dispatch'

let dispatcher: BackgroundExpo | undefined
let defined = false

/** Detach a disposed service, so a late OS wake-up reaches nothing. */
function releaseDispatcher(service: BackgroundExpo): void {
  if (dispatcher === service) dispatcher = undefined
}

function defineDispatcher(service: BackgroundExpo): void {
  dispatcher = service
  if (defined) return
  defined = true
  try {
    TaskManager.defineTask(DISPATCH_TASK, async () => {
      await dispatcher?.runScheduled()
      return BackgroundTask.BackgroundTaskResult.Success
    })
  } catch {
    // `defineTask` throws when called after the app has finished starting on
    // some platforms. Losing background work is survivable; a boot is not.
    defined = false
  }
}

export const name = 'core-background-mobile'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.background` is usable.
 */
export async function apply(ctx: Context, config: BackgroundExpoConfig = {}) {
  ctx.logger.info('core-background-mobile: loaded')
  const fiber = await ctx.plugin(BackgroundExpo, config)
  return () => void fiber.dispose()
}

export default { name, apply }
