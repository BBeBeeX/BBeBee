/**
 * `ctx.quickActions` on iOS and Android, over `expo-quick-actions`.
 *
 * The home-screen long-press menu: the two things a cold user wants fastest —
 * Recently Played and Search — plus whatever a later caller replaces the list
 * with. A thin service carrying a disproportionate share of edge, because the
 * two halves of its job sit on opposite sides of a process boundary: it
 * *writes* shortcuts the OS shows while the app is dead, and *reads* actions
 * the OS delivers while it is alive. See the contract:
 * packages/protocol/src/services/integration.ts.
 *
 * Five things are load-bearing and easy to get wrong:
 *
 * - **The OS reports its own menu limit, and it is read, not assumed.** The
 *   lib exports `maxCount` (four on iOS; Android launchers vary) and leaves
 *   it `undefined` where it cannot tell. A longer list than the menu shows is
 *   a caller's overshoot, not a failure the caller could act on, so it is
 *   sliced here — first `maxCount` win, four where the lib is silent — in the
 *   caller's order, rather than rejected.
 * - **The SDK has two icon vocabularies, and only one is literal.** The
 *   twenty-nine icons the OS renders natively ('search', 'time', 'play'…)
 *   pass verbatim; every other SF Symbol rides the lib's `symbol:` escape
 *   hatch. The contract's `icon` *is* an SF Symbol name, so the mapping is
 *   verbatim-or-prefixed and nothing else. Where Android cannot resolve an
 *   icon it renders text — the lib's own fallback, not this service's
 *   problem.
 * - **A cold-launch action is consumed, never replayed.** The lib's
 *   `initial` is a synchronous const describing how this process started,
 *   read once at init and handed over exactly once by `consumeInitial()`.
 *   Exactly once is per *process*, not per plugin instance: the const never
 *   empties, so without the module-level flag a plugin reload would re-stash
 *   the same action and hand a second consumer a replay of a navigation the
 *   user has already seen (the contract says so in as many words).
 * - **`supported` has two ways to be false, and only one is a failure.** A
 *   build without the native module — Expo Go, a dev build without the
 *   config plugin — resolves `isSupported()` to `false` and says nothing:
 *   the OS merely has no menu to fill. A call that *rejects* is different:
 *   the module is linked but the bridge is broken, `supported` flips with
 *   one warn, the OS listener comes down, and every later call is a no-op. A
 *   missing home-screen menu is a lost feature; a boot that died over it
 *   would have its priorities inverted.
 * - **Params are the OS's channel, not a bridge.** The SDK's own typings
 *   admit only JSON primitives — launch params ride the shortcut through the
 *   OS itself — so a value that channel cannot carry is dropped in the
 *   mapping rather than cast into a refusal the OS would make anyway.
 */

import { addListener, initial, isSupported, maxCount, setItems } from 'expo-quick-actions'
import type { Action } from 'expo-quick-actions'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Disposable, QuickActionItem, QuickActionsService } from '@BBeBee/protocol'

/**
 * Shortcut id → the route id the shells navigate to.
 *
 * Exported so the integration wiring — and any caller that renders its own
 * shortcut list — reuses one mapping instead of restating it. `plugin-history`
 * names its page `history.view` and `plugin-sources` names search
 * `sources.search`, and a shortcut wired to a misspelled route navigates
 * nowhere, silently.
 */
export const QUICK_ACTION_ROUTES: Readonly<Record<string, string>> = {
  history: 'history.view',
  search: 'sources.search',
}

/** Four where the lib cannot report `maxCount` — iOS's own number. */
const DEFAULT_MAX_COUNT = 4

/**
 * The icons the OS renders natively — `AppleBuiltInIcons` from the SDK's own
 * typings, spelled out so a typo here is a review comment rather than a
 * shortcut silently falling back to `symbol:`. Keep in step with
 * `expo-quick-actions/build/index.d.ts`.
 */
const APPLE_BUILT_IN_ICONS: ReadonlySet<string> = new Set([
  'compose',
  'play',
  'pause',
  'add',
  'location',
  'search',
  'share',
  'prohibit',
  'contact',
  'home',
  'markLocation',
  'favorite',
  'love',
  'cloud',
  'invitation',
  'confirmation',
  'mail',
  'message',
  'date',
  'time',
  'capturePhoto',
  'captureVideo',
  'task',
  'taskCompleted',
  'alarm',
  'bookmark',
  'shuffle',
  'audio',
  'update',
])

/**
 * The defaults installed at boot: the two things a cold user wants fastest,
 * with the route riding in `params` so a consumer that never sees
 * `QUICK_ACTION_ROUTES` still knows where the shortcut meant to go. Both
 * icons are the OS's own — no `symbol:` needed for either.
 */
const DEFAULT_ACTIONS: readonly QuickActionItem[] = [
  { id: 'history', title: 'Recently Played', icon: 'time', params: { route: 'history.view' } },
  { id: 'search', title: 'Search', icon: 'search', params: { route: 'sources.search' } },
]

/**
 * Whether this process has already handed its launch action over. Module-level
 * on purpose: `initial` is a const the OS fills once per process and never
 * empties, so this flag — not the per-instance stash — is what stops a plugin
 * reload from re-serving the same action to a second consumer. See the file
 * header.
 */
let launchActionConsumed = false

/** @internal — hands the launch action back to the pool; tests only. */
export function resetLaunchActionConsumedForTests(): void {
  launchActionConsumed = false
}

export interface QuickActionsExpoConfig {
  /** Replaces the built-in defaults at boot. Still capped at `maxCount`. */
  actions?: readonly QuickActionItem[]
}

export class QuickActionsExpo extends Service implements QuickActionsService {
  /**
   * The plugin's own context, captured at construction: inside a method
   * reached through the service proxy Cordis shadows `this.ctx` to the
   * *caller's* context. See the note in `plugin-library`.
   */
  private readonly ownCtx: Context

  /** What `isSupported()` answered at init — false until the OS says otherwise. */
  private osSupported = false

  /** Set the first time a native call rejects; see the file header. */
  private unavailable = false

  /** The cold-launch action, stashed until `consumeInitial()` takes it. */
  private initialItem?: QuickActionItem

  private readonly listeners = new Set<(item: QuickActionItem) => void>()
  private subscription?: { remove(): void }

  constructor(
    ctx: Context,
    private readonly config: QuickActionsExpoConfig = {},
  ) {
    super(ctx, 'quickActions')
    this.ownCtx = ctx
  }

  get supported(): boolean {
    return this.osSupported && !this.unavailable
  }

  async [Service.init]() {
    // Cold capture first: `initial` is a synchronous const describing how
    // this process started, and reading it can neither wait nor fail, so it
    // is taken before anything else can degrade the service.
    this.initialItem = normalize(initial)

    const supported = await this.guard('isSupported', () => isSupported())
    // A resolved `false` is the OS having no menu — not a failure, so not one
    // warn; there is simply nothing to register or install.
    if (supported !== true) return
    this.osSupported = true

    // Registration follows the probe, so the listener exists before the
    // writes: a shortcut tapped *during* boot is delivered by the OS to the
    // freshly-registered listener rather than lost in the gap.
    const subscription = await this.guard('addListener', () =>
      addListener((action) => {
        // An action without a usable id is not an action; dropped here rather
        // than inside dispatch so the cold path stays explicit about its own.
        const item = normalize(action)
        if (item) this.dispatch(item)
      }),
    )
    if (subscription) this.subscription = subscription

    await this.set(this.config.actions ?? DEFAULT_ACTIONS)

    return () => {
      this.subscription?.remove()
      this.subscription = undefined
      this.listeners.clear()
      // A reload must not hand its consumer a stash the previous instance
      // already emptied — and the once-per-process flag keeps init from
      // re-serving the action the reload re-reads from the same const.
      this.initialItem = undefined
    }
  }

  async set(items: readonly QuickActionItem[]): Promise<void> {
    if (!this.supported) return
    const cap = maxCount ?? DEFAULT_MAX_COUNT
    // More than the menu shows is a caller's overshoot, not an error the
    // caller could act on — sliced, first `cap` win, in the caller's order.
    const native = items.slice(0, cap).map(toNativeAction)
    await this.guard('setItems', () => setItems(native))
  }

  async clear(): Promise<void> {
    if (!this.supported) return
    // The SDK has no clear of its own; an empty list is the same statement.
    await this.guard('setItems', () => setItems([]))
  }

  /**
   * The action that launched the app, once. The second call answers
   * `undefined` — a late subscriber must not replay a navigation the user has
   * already seen — and taking the item dispatches it exactly as a warm one.
   */
  consumeInitial(): QuickActionItem | undefined {
    const item = this.initialItem
    this.initialItem = undefined
    if (!item) return undefined
    if (launchActionConsumed) return undefined
    launchActionConsumed = true
    this.dispatch(item)
    return item
  }

  onAction(cb: (item: QuickActionItem) => void): Disposable {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  /* ── internals ──────────────────────────────────────────────────────────── */

  /**
   * Deliver one action, cold or warm, through every channel once.
   *
   * Delivery is a fact; navigation is a policy. An unknown id still announces
   * itself — the event is how a future integration learns of shortcuts this
   * build does not map — but `ui/navigate` fires only for ids the map knows,
   * because a route that does not exist is a navigation that silently does
   * nothing.
   */
  private dispatch(item: QuickActionItem): void {
    this.ownCtx.emit('quick-actions/action', item)
    const routeId = QUICK_ACTION_ROUTES[item.id]
    if (routeId !== undefined) {
      this.ownCtx.emit('ui/navigate', routeId, item.params)
    }
    for (const listener of [...this.listeners]) listener(item)
  }

  /**
   * One native call, or the degradation. A rejected promise and a synchronous
   * throw (an unlinked module) are the same case here — both mean the bridge
   * behind this build's home-screen menu is broken.
   */
  private async guard<T>(op: string, call: () => T): Promise<T | undefined> {
    if (this.unavailable) return undefined
    try {
      return await call()
    } catch {
      this.markUnavailable(op)
      return undefined
    }
  }

  private markUnavailable(op: string): void {
    // The flag goes up before the warn: two calls in flight when the bridge
    // dies race to report it, and the loser must find the flag already set
    // rather than warn a second time.
    if (this.unavailable) return
    this.unavailable = true
    // The OS listener comes down with the flag: a service that has declared
    // itself off must not still navigate from a delivery the OS makes later.
    this.subscription?.remove()
    this.subscription = undefined
    this.ownCtx.logger.warn(
      `quickActions: native module refused "${op}" — home-screen shortcuts are off for the rest of this session`,
    )
  }
}

/**
 * One contract item onto the SDK's `Action`. Optional fields stay absent when
 * the caller omitted them — `icon: undefined` would hand the OS a reference
 * to nothing it can render, the same trade the subtitle and params mappings
 * make.
 */
function toNativeAction(item: QuickActionItem): Action {
  return {
    id: item.id,
    title: item.title,
    ...(item.subtitle !== undefined ? { subtitle: item.subtitle } : {}),
    ...(item.icon !== undefined ? { icon: toNativeIcon(item.icon) } : {}),
    ...(item.params !== undefined ? { params: toNativeParams(item.params) } : {}),
  }
}

/**
 * The contract's SF Symbol name onto the OS's vocabulary: the icons the SDK
 * spells natively pass verbatim, everything else rides `symbol:`. Where
 * Android cannot resolve the result it renders text — the lib's fallback.
 */
function toNativeIcon(icon: string): Action['icon'] {
  return APPLE_BUILT_IN_ICONS.has(icon) ? icon : `symbol:${icon}`
}

/**
 * The params the OS will echo back on delivery, restricted to the JSON
 * primitives its own typings admit. The protocol's `unknown` is wider on
 * purpose; a value the channel cannot carry — an object a caller smuggled
 * into `params` — is dropped here rather than cast into a channel the OS
 * would refuse anyway.
 */
function toNativeParams(params: Record<string, unknown>): NonNullable<Action['params']> {
  const serializable: Record<string, number | string | boolean | null | undefined> = {}
  for (const [key, value] of Object.entries(params)) {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'number' ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    ) {
      serializable[key] = value
    }
  }
  return serializable
}

/**
 * An OS-delivered action onto the contract's shape. Anything without a string
 * `id` is undeliverable — nothing downstream could map or deduplicate it — so
 * it answers `undefined` and the caller drops it, the same trade
 * `core-media-session-mobile` makes for an unmappable press. A string icon
 * passes through as delivered: the OS speaks its own vocabulary back.
 */
function normalize(action: Action | undefined): QuickActionItem | undefined {
  if (!action || typeof action.id !== 'string') return undefined
  return {
    id: action.id,
    title: typeof action.title === 'string' ? action.title : action.id,
    ...(action.subtitle != null ? { subtitle: action.subtitle } : {}),
    ...(typeof action.icon === 'string' ? { icon: action.icon } : {}),
    ...(action.params != null ? { params: action.params } : {}),
  }
}

export default QuickActionsExpo
