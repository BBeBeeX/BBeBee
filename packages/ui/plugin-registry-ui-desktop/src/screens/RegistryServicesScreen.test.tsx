// @vitest-environment jsdom
/**
 * Registry services screen tests — rendered against a stub
 * `plugin-manager` the way the shell would bind it. The screen lists
 * every service key with more than one provider and lets the user
 * switch the active one; critical keys render locked.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { ServiceProviderInfo } from '@BBeBee/protocol'
import { RegistryServicesScreen } from './RegistryServicesScreen.js'

afterEach(cleanup)

/* ── harness ─────────────────────────────────────────────────────────────── */

interface HarnessOptions {
  infos?: ServiceProviderInfo[]
  /** Register the service but leave listServiceProviders off (host without arbitration). */
  noListServiceProviders?: boolean
  /** Don't register the plugin-manager service at all. */
  noService?: boolean
  /** setServiceProvider rejects with this error. */
  switchError?: Error
}

async function harness(options: HarnessOptions = {}) {
  const switchCalls: Array<{ key: string; providerId: string }> = []

  class ManagerStub extends Service {
    listServiceProviders?: () => ServiceProviderInfo[]
    setServiceProvider = async (key: string, providerId: string): Promise<void> => {
      switchCalls.push({ key, providerId })
      if (options.switchError) throw options.switchError
    }

    constructor(ctx: Context) {
      super(ctx, 'plugin-manager')
      if (!options.noListServiceProviders) {
        this.listServiceProviders = () => options.infos ?? []
      }
    }
  }

  const root = new Context()
  if (!options.noService) await root.plugin(ManagerStub)

  let scoped: Context | undefined
  if (!options.noService) {
    root.inject(['plugin-manager'], (s) => void (scoped = s))
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!scoped) throw new Error('failed to scope')
    return { ctx: scoped, switchCalls }
  }
  return { ctx: root, switchCalls }
}

const INFOS: ServiceProviderInfo[] = [
  {
    key: 'visualizer',
    critical: false,
    providers: ['@bbebee/plugin-visualizer', 'bbebee-plugin-visualizer-meters'],
    activeProvider: '@bbebee/plugin-visualizer',
  },
  {
    key: 'player',
    critical: true,
    providers: ['@bbebee/plugin-player', 'third-party-player'],
    activeProvider: '@bbebee/plugin-player',
  },
]

/* ── rendering ───────────────────────────────────────────────────────────── */

describe('RegistryServicesScreen', () => {
  it('lists multi-provider keys, marks the active provider, and switches on click', async () => {
    const { ctx, switchCalls } = await harness({ infos: INFOS })
    const { getByTestId } = render(h(RegistryServicesScreen, { ctx }))

    const visualizer = getByTestId('registry-service-row-visualizer')
    expect(visualizer.textContent).toContain('@bbebee/plugin-visualizer')
    expect(visualizer.textContent).toContain('bbebee-plugin-visualizer-meters')
    expect(visualizer.textContent).toContain('Active')

    const switchButton = getByTestId(
      'registry-service-switch-visualizer-bbebee-plugin-visualizer-meters',
    )
    fireEvent.click(switchButton)
    expect(switchCalls).toEqual([
      { key: 'visualizer', providerId: 'bbebee-plugin-visualizer-meters' },
    ])
  })

  it('renders critical keys locked, with no switch control', async () => {
    const { ctx, switchCalls } = await harness({ infos: INFOS })
    const { getByTestId, queryByTestId } = render(h(RegistryServicesScreen, { ctx }))

    const player = getByTestId('registry-service-row-player')
    expect(player.textContent).toContain('Critical service')
    expect(queryByTestId('registry-service-switch-player-third-party-player')).toBeNull()
    expect(switchCalls).toEqual([])
  })

  it('shows the empty state when no key has several providers', async () => {
    const { ctx } = await harness({ infos: [] })
    const { getByTestId, queryByTestId } = render(h(RegistryServicesScreen, { ctx }))

    expect(getByTestId('registry-services-screen').textContent).toContain('No shared services')
    expect(queryByTestId('registry-service-row-visualizer')).toBeNull()
  })

  it('shows the not-loaded state when the manager service is absent', async () => {
    const { ctx } = await harness({ noService: true })
    const { getByTestId } = render(h(RegistryServicesScreen, { ctx }))

    expect(getByTestId('registry-services-screen').textContent).toContain('Plugin manager not loaded')
  })

  it('shows the not-loaded state when the host omits provider arbitration', async () => {
    const { ctx } = await harness({ noListServiceProviders: true })
    const { getByTestId } = render(h(RegistryServicesScreen, { ctx }))

    expect(getByTestId('registry-services-screen').textContent).toContain('Plugin manager not loaded')
  })

  it('surfaces a switch failure instead of crashing', async () => {
    const { ctx, switchCalls } = await harness({
      infos: INFOS,
      switchError: new Error('CRITICAL_PROVIDER'),
    })
    const { getByTestId, findByTestId } = render(h(RegistryServicesScreen, { ctx }))

    fireEvent.click(
      getByTestId('registry-service-switch-visualizer-bbebee-plugin-visualizer-meters'),
    )
    const error = await findByTestId('registry-services-error')
    expect(error.textContent).toContain('CRITICAL_PROVIDER')
    expect(switchCalls).toEqual([
      { key: 'visualizer', providerId: 'bbebee-plugin-visualizer-meters' },
    ])
  })
})
