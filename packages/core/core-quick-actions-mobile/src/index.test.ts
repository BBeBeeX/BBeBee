/**
 * `core-quick-actions-mobile` against the real-API stub.
 *
 * `expo-quick-actions` is aliased to `test/stubs/expo-quick-actions.ts` under
 * Vitest, which mirrors the SDK's 6.x surface — the synchronous `initial`
 * const, the `maxCount` report, `setItems`, `isSupported`, `addListener` —
 * and keeps the shortcut list where a test can read it. The cold/warm split
 * is staged through the stub's levers: `__setInitial` poses as a launch
 * caused by a shortcut, `__emitAction` poses as the OS delivering one while
 * the app runs. The stub cannot refuse on its own, and half this service's
 * contract is about refusal — so the degradation tests script rejections
 * with `vi.spyOn`, because a stub that cannot fail cannot prove the boot
 * survives a module that does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { QuickActionItem } from '@BBeBee/protocol'
import { QuickActionsExpo, QUICK_ACTION_ROUTES, resetLaunchActionConsumedForTests } from './index.js'
import type { QuickActionsExpoConfig } from './index.js'

/** One action as the stub shapes it (the SDK's own `Action`, loosely). */
interface StubAction {
  id: string
  title: string
  subtitle?: string | null
  icon?: string | null
  params?: Record<string, number | string | boolean | null | undefined> | null
}

/**
 * The stub's levers, reached through the package name rather than a path
 * that would cross this package's rootDir — the same trade the secrets and
 * haptics tests make.
 */
async function stub() {
  const mod = (await import('expo-quick-actions')) as unknown as {
    __items?: () => readonly StubAction[]
    __emitAction?: (action: StubAction) => void
    __setInitial?: (action: StubAction | null) => void
    __setMaxCount?: (count: number | undefined) => void
    __setSupported?: (on: boolean) => void
    __resetForTests?: () => void
    setItems: (data?: StubAction[]) => Promise<void>
    isSupported: () => Promise<boolean>
  }
  return mod
}

async function items(): Promise<readonly StubAction[]> {
  return (await stub()).__items?.() ?? []
}

/** Capture both events the service emits, in the order they arrived. */
function record(ctx: Context) {
  const actions: QuickActionItem[] = []
  const navigations: Array<[string, Record<string, unknown> | undefined]> = []
  const offs = [
    ctx.on('quick-actions/action', (item) => actions.push(item)),
    ctx.on('ui/navigate', (routeId, params) => navigations.push([routeId, params])),
  ]
  return { actions, navigations, stop: () => { for (const off of offs) off() } }
}

async function harness(config: QuickActionsExpoConfig = {}) {
  const ctx = new Context()
  // The degradation path warns during boot, so the spy must wrap the logger
  // before the plugin starts — which is why the harness owns the construction.
  const warn = vi.spyOn(ctx.logger, 'warn')
  const fiber = await ctx.plugin(QuickActionsExpo, config)
  return { ctx, fiber, quickActions: ctx.quickActions, warn }
}

beforeEach(async () => {
  const mod = await stub()
  mod.__resetForTests?.()
  // The service's once-per-process flag outlives every harness in this file;
  // each cold-launch test must find the launch action untaken.
  resetLaunchActionConsumedForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('core-quick-actions-mobile', () => {
  it('installs the two defaults at boot', async () => {
    await harness()
    expect(await items()).toEqual([
      {
        id: 'history',
        title: 'Recently Played',
        // 'time' is one of the OS's own icons — verbatim, no `symbol:`.
        icon: 'time',
        params: { route: 'history.view' },
      },
      {
        id: 'search',
        title: 'Search',
        icon: 'search',
        params: { route: 'sources.search' },
      },
    ])
  })

  it('maps items onto the native shape', async () => {
    const { quickActions } = await harness()
    await quickActions.set([
      { id: 'a', title: 'A', subtitle: 'sub', icon: 'star', params: { q: 'x' } },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C', icon: 'play' },
    ])
    expect(await items()).toEqual([
      // 'star' is not one of the OS's own, so it rides the escape hatch.
      { id: 'a', title: 'A', subtitle: 'sub', icon: 'symbol:star', params: { q: 'x' } },
      // No icon means no `icon` key at all — `icon: undefined` would hand
      // the OS a reference to nothing it can render.
      { id: 'b', title: 'B' },
      // 'play' is one of the OS's own — verbatim, no prefix.
      { id: 'c', title: 'C', icon: 'play' },
    ])
  })

  it('caps the list at the OS-reported maxCount, keeping the caller order', async () => {
    const mod = await stub()
    mod.__setMaxCount?.(2)
    const { quickActions } = await harness()
    await quickActions.set([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ])
    expect((await items()).map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('falls back to four where the lib cannot report a limit', async () => {
    const mod = await stub()
    mod.__setMaxCount?.(undefined)
    const { quickActions } = await harness()
    const six: QuickActionItem[] = Array.from({ length: 6 }, (_, i) => ({
      id: `item-${i}`,
      title: `Item ${i}`,
    }))
    await quickActions.set(six)
    expect((await items()).map((s) => s.id)).toEqual([
      'item-0',
      'item-1',
      'item-2',
      'item-3',
    ])
  })

  it('lets config replace the default set', async () => {
    await harness({ actions: [{ id: 'downloads', title: 'Downloads', icon: 'tray.and.arrow.down' }] })
    expect(await items()).toEqual([
      { id: 'downloads', title: 'Downloads', icon: 'symbol:tray.and.arrow.down' },
    ])
  })

  it('clears the whole list', async () => {
    const { quickActions } = await harness()
    await quickActions.clear()
    expect(await items()).toEqual([])
  })
})

describe('the route map', () => {
  it('spells the routes the shells actually register', () => {
    /*
     * `plugin-history`'s HISTORY_ROUTES names the page `history.view` — not
     * `history` — and `plugin-sources`' SOURCES_ROUTES names search
     * `sources.search`; a shortcut wired to anything else navigates nowhere,
     * silently. This pins the spelling at the one place it lives.
     */
    expect(QUICK_ACTION_ROUTES).toEqual({ history: 'history.view', search: 'sources.search' })
  })
})

describe('warm actions', () => {
  it('delivers a warm action as both events, and to subscribers', async () => {
    const { ctx, quickActions } = await harness()
    const { actions, navigations, stop } = record(ctx)
    const received: QuickActionItem[] = []
    const off = quickActions.onAction((item) => received.push(item))

    const mod = await stub()
    mod.__emitAction?.({
      id: 'search',
      title: 'Search',
      subtitle: 'Every source',
      icon: 'magnifyingglass',
      params: { route: 'sources.search' },
    })

    expect(actions).toEqual([
      {
        id: 'search',
        title: 'Search',
        subtitle: 'Every source',
        icon: 'magnifyingglass',
        params: { route: 'sources.search' },
      },
    ])
    expect(navigations).toEqual([['sources.search', { route: 'sources.search' }]])
    expect(received.map((item) => item.id)).toEqual(['search'])
    off()
    stop()
  })

  it('announces an unknown id without navigating', async () => {
    const { ctx } = await harness()
    const { actions, navigations, stop } = record(ctx)

    const mod = await stub()
    mod.__emitAction?.({ id: 'mystery', title: 'Somewhere Else' })

    // Delivery is a fact, navigation is a policy: the action is announced,
    // but no route answers to `mystery` and none is guessed.
    expect(actions.map((item) => item.id)).toEqual(['mystery'])
    expect(navigations).toEqual([])
    stop()
  })
})

describe('cold launch', () => {
  it('hands the launch action over exactly once', async () => {
    const mod = await stub()
    mod.__setInitial?.({
      id: 'history',
      title: 'Recently Played',
      icon: 'clock',
      params: { route: 'history.view' },
    })

    const { ctx, quickActions } = await harness()
    const { actions, navigations, stop } = record(ctx)
    const received: QuickActionItem[] = []
    quickActions.onAction((item) => received.push(item))

    const taken = quickActions.consumeInitial()
    expect(taken).toEqual({
      id: 'history',
      title: 'Recently Played',
      icon: 'clock',
      params: { route: 'history.view' },
    })
    // A late subscriber must not replay a navigation the user has already
    // seen — the contract says so in as many words.
    expect(quickActions.consumeInitial(), 'exactly once').toBeUndefined()

    expect(actions.map((item) => item.id)).toEqual(['history'])
    expect(navigations).toEqual([['history.view', { route: 'history.view' }]])
    expect(received.map((item) => item.id)).toEqual(['history'])
    stop()
  })

  it('consumes an unknown launch id without navigating', async () => {
    const mod = await stub()
    mod.__setInitial?.({ id: 'mystery', title: 'Somewhere Else' })

    const { ctx, quickActions } = await harness()
    const { actions, navigations, stop } = record(ctx)

    expect(quickActions.consumeInitial()?.id).toBe('mystery')
    expect(actions.map((item) => item.id)).toEqual(['mystery'])
    expect(navigations).toEqual([])
    stop()
  })

  it('answers undefined when the OS reports no launch action', async () => {
    const mod = await stub()
    mod.__setInitial?.(null)

    const { ctx, quickActions } = await harness()
    const { actions, navigations, stop } = record(ctx)
    expect(quickActions.consumeInitial()).toBeUndefined()
    expect(actions).toEqual([])
    expect(navigations).toEqual([])
    stop()
  })

  it('answers undefined when `initial` was never set', async () => {
    const { ctx, quickActions } = await harness()
    const { actions, navigations, stop } = record(ctx)
    expect(quickActions.consumeInitial()).toBeUndefined()
    expect(actions).toEqual([])
    expect(navigations).toEqual([])
    stop()
  })
})

describe('a build the OS cannot serve', () => {
  it('reports unsupported, silently, where the OS has no shortcuts', async () => {
    const mod = await stub()
    mod.__setSupported?.(false)
    const setItemsSpy = vi.spyOn(mod, 'setItems')

    const { quickActions, warn } = await harness()
    // Expo Go and a dev build without the config plugin resolve
    // `isSupported()` to false: the OS merely has no menu, which is not a
    // failure — so not one warn, and no native write at all.
    expect(quickActions.supported).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    expect(setItemsSpy).not.toHaveBeenCalled()
    expect(await items()).toEqual([])

    await quickActions.set([{ id: 'x', title: 'X' }])
    await quickActions.clear()
    expect(setItemsSpy).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('degrades on the first native refusal and never tries again', async () => {
    const mod = await stub()
    const setItemsSpy = vi.spyOn(mod, 'setItems').mockRejectedValueOnce(new Error('not linked'))

    const { ctx, quickActions, warn } = await harness()
    expect(quickActions.supported).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/quickActions/)
    expect(await items()).toEqual([])

    // Every later call is a no-op: no native write, no second warning — the
    // same contract the haptics engine's absence holds.
    await quickActions.set([{ id: 'x', title: 'X' }])
    await quickActions.clear()
    expect(setItemsSpy).toHaveBeenCalledTimes(1) // the boot attempt, nothing after
    expect(warn).toHaveBeenCalledTimes(1)

    // The degradation took the OS listener down with it, so a delivery the
    // OS makes anyway reaches nothing rather than navigating a dead
    // service's routes.
    const { actions, stop } = record(ctx)
    mod.__emitAction?.({ id: 'search', title: 'Search' })
    expect(actions).toEqual([])
    stop()
  })

  it('flips supported when the OS refuses even the support probe', async () => {
    const mod = await stub()
    const setItemsSpy = vi.spyOn(mod, 'setItems')
    vi.spyOn(mod, 'isSupported').mockRejectedValueOnce(new Error('bridge gone'))

    const { quickActions, warn } = await harness()
    expect(quickActions.supported).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    // The probe refused, so nothing was ever written and nothing listens.
    expect(setItemsSpy).not.toHaveBeenCalled()
    expect(await items()).toEqual([])
  })
})

describe('teardown', () => {
  it('removes its OS listener when the service stops', async () => {
    const { ctx, fiber } = await harness()
    const received: QuickActionItem[] = []
    ctx.quickActions.onAction((item) => received.push(item))
    const { actions, stop } = record(ctx)

    await fiber.dispose()

    // The OS keeps delivering, as it would to any app in the foreground: a
    // disposed service must not react, navigate, or notify.
    const mod = await stub()
    mod.__emitAction?.({ id: 'search', title: 'Search' })
    expect(actions).toEqual([])
    expect(received).toEqual([])
    stop()
  })
})
