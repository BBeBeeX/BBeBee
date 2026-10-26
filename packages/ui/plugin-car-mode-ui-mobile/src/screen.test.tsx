// @vitest-environment jsdom
/**
 * The mobile car-mode surface.
 *
 * Rendered against DOM host components — the same seam `apps/mobile` uses to
 * hand over the real `react-native`. Smoke-level, like the sibling screen
 * tests: the view binds, the four controls reach the player and the service,
 * and activation opens the screen.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { CarModeTrigger, Contribution, SlotContribution, TransportState } from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { CAR_MODE_VIEWS } from '@bbebee/plugin-car-mode/views'
import plugin, { CarModeScreen } from './index.js'

afterEach(cleanup)

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (e: { stopPropagation: () => void }) => {
          e.stopPropagation()
          ;(onPress as () => void)()
        } : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
    accessibilityLabel?: string
  }) {
    const items = props.data ?? []
    return h(
      'div',
      { 'data-host': 'FlashList', 'data-label': props.accessibilityLabel, role: 'list' },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
          ),
    )
  },
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

const IDLE: TransportState = {
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  bufferedMs: 0,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  playMode: 'sequence',
}

/** A `ctx.player` + `ctx.carMode` + `ctx.ui` with what the screen reads and calls. */
async function harness(state: Partial<TransportState> = {}) {
  const calls: string[] = []
  const transport: TransportState = { ...IDLE, ...state }

  class PlayerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'player')
    }
    get state() {
      return transport
    }
    togglePlay = () => void calls.push('togglePlay')
    next = async () => void calls.push('next')
    previous = async () => void calls.push('previous')
  }

  class CarModeStub extends Service {
    private current: CarModeTrigger | undefined = 'manual'
    constructor(ctx: Context) {
      super(ctx, 'carMode')
    }
    get enabled() {
      return true
    }
    setEnabled() {}
    get active() {
      return this.current !== undefined
    }
    get trigger() {
      return this.current
    }
    activate = (trigger: CarModeTrigger) => {
      this.current = trigger
      calls.push(`activate:${trigger}`)
    }
    deactivate = (trigger: CarModeTrigger) => {
      calls.push(`deactivate:${trigger}`)
      if (this.current === trigger) this.current = undefined
    }
    get autoOnCharging() {
      return false
    }
    setAutoOnCharging() {}
  }

  class UiStub extends Service {
    readonly views = new Map<string, unknown>()
    readonly contributions: Contribution[] = []
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    navigate = (routeId: string) => void calls.push(`navigate:${routeId}`)
    registerView = (id: string, component: unknown) => {
      this.views.set(id, component)
      this.ctx.emit('ui/changed')
      return () => void this.views.delete(id)
    }
    contribute = (c: Contribution) => {
      this.contributions.push(c)
      this.ctx.emit('ui/changed')
      return () => {
        const index = this.contributions.indexOf(c)
        if (index >= 0) this.contributions.splice(index, 1)
      }
    }
    slotsFor = (slot: string): SlotContribution[] =>
      this.contributions.filter((c): c is SlotContribution => c.kind === 'slot' && c.slot === slot)
    viewFor = (id: string) => this.views.get(id)
  }

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(CarModeStub)
  await ctx.plugin(UiStub)
  return { ctx, calls, ui: ctx.ui as unknown as UiStub, carMode: ctx.carMode as unknown as CarModeStub }
}

describe('car-mode-ui-mobile plugin entry', () => {
  it('apply registers the view and the settings entrance, and activation opens the screen', async () => {
    const { ctx, calls, ui } = await harness()
    const fiber = await ctx.plugin(plugin)

    // The view is bound to the plugin's context and renders through the stubs.
    expect(ui.views.has(CAR_MODE_VIEWS.carMode)).toBe(true)

    // The manual entrance: a settings link row, exactly plugin-history's
    // answer for a route with no tab.
    expect(
      ui.contributions.some((c) => c.id === CAR_MODE_VIEWS.carMode && c.kind === 'settings'),
    ).toBe(true)

    // Auto-activation navigates to the screen; deactivation leaves the
    // stack alone.
    const before = calls.length
    ctx.emit('car-mode/changed', true, 'charging')
    expect(calls.slice(before)).toEqual(['navigate:car-mode.view'])
    const settled = calls.length
    ctx.emit('car-mode/changed', false, undefined)
    expect(calls.length).toBe(settled)

    await fiber.dispose()
  })
})

describe('CarModeScreen on mobile', () => {
  it('renders the track and the four controls; presses reach player and carMode', async () => {
    const { ctx, calls } = await harness({
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
      status: 'playing',
    })
    const { container } = render(h(CarModeScreen, { ctx }))

    expect(container.textContent).toContain('Solar')
    expect(container.textContent).toContain('Miles Davis')

    const pause = container.querySelector('[data-label="Pause"]') as HTMLElement
    await act(async () => {
      pause.click()
    })
    expect(calls).toContain('togglePlay')

    const next = container.querySelector('[data-label="Next track"]') as HTMLElement
    await act(async () => {
      next.click()
    })
    expect(calls).toContain('next')

    const previous = container.querySelector('[data-label="Previous track"]') as HTMLElement
    await act(async () => {
      previous.click()
    })
    expect(calls).toContain('previous')

    const exit = container.querySelector('[data-label="Exit car mode"]') as HTMLElement
    await act(async () => {
      exit.click()
    })
    expect(calls).toContain('deactivate:manual')
    expect(calls).toContain('navigate:library.home')
  })

  it('offers Play while paused, and a placeholder while idle', async () => {
    const { ctx } = await harness({ status: 'paused' })
    const { container } = render(h(CarModeScreen, { ctx }))
    expect(container.querySelector('[data-label="Play"]')).toBeTruthy()
    expect(container.textContent).toContain('Nothing playing')
  })

  it('exit names the live trigger, so a charging-activated mode can leave too', async () => {
    const { ctx, calls, carMode } = await harness({
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: { title: 'Solar' },
      status: 'playing',
    })
    carMode.activate('charging')
    const { container } = render(h(CarModeScreen, { ctx }))

    const exit = container.querySelector('[data-label="Exit car mode"]') as HTMLElement
    await act(async () => {
      exit.click()
    })
    expect(calls).toContain('deactivate:charging')
    expect(carMode.active).toBe(false)
  })
})
