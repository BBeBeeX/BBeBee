// @vitest-environment jsdom
/**
 * Mobile plugin-manager UI tests — the management screen and the plugin
 * entry, rendered against stub services the way the mobile shell would bind
 * them. The harness follows `plugin-registry-ui-mobile`'s: injected host
 * primitives, a cordis `Context`, and an English i18n stub serving the real
 * `settings` catalogue.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { Context, Service } from 'cordis'
import type { I18nService, PluginInfo, PluginManagerService } from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import settingsCatalogue from '../../../feature/plugin-i18n/src/locales/settings.json'
import appCatalogue from '../../../feature/plugin-i18n/src/locales/en.json'
import plugin, { MANAGER_VIEWS, PluginManagerScreen } from './index.js'

afterEach(cleanup)

/* ── the injected native primitives, as host components ──────────────────── */

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, accessibilityState, onPress, testID } =
      props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-state': accessibilityState ? JSON.stringify(accessibilityState) : undefined,
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
  TextInput: function TextInput(props: Record<string, unknown>) {
    const { testID, accessibilityLabel, value, onChangeText, placeholder, editable } = props
    return h('input', {
      'data-host': 'TextInput',
      'data-testid': typeof testID === 'string' ? testID : undefined,
      'aria-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
      value: typeof value === 'string' ? value : '',
      placeholder: typeof placeholder === 'string' ? placeholder : undefined,
      disabled: editable === false,
      onChange: typeof onChangeText === 'function'
        ? (e: { target: { value: string } }) => (onChangeText as (v: string) => void)(e.target.value)
        : undefined,
    })
  },
})

/* ── fixtures ────────────────────────────────────────────────────────────── */

function makePlugin(patch: Partial<PluginInfo> & { id: string }): PluginInfo {
  return {
    name: patch.id,
    displayName: patch.id,
    version: '1.0.0',
    systemId: 'layer-4',
    enabled: true,
    state: 'ACTIVE',
    waitingFor: [],
    dependencies: [],
    dependents: [],
    ...patch,
  }
}

/** Real ids, so `criticalServiceKeysOfProvider` (the generated protocol map) applies. */
const MANIFEST_PLUGINS: readonly PluginInfo[] = [
  makePlugin({
    id: '@bbebee/plugin-manager',
    name: 'plugin-manager',
    displayName: 'Plugin Manager',
    version: '0.0.0',
    systemId: 'layer-4',
    moduleId: 'plugins',
  }),
  makePlugin({
    id: '@bbebee/plugin-history',
    name: 'plugin-history',
    displayName: 'History',
    version: '0.2.0',
    systemId: 'layer-4',
    moduleId: 'storage',
    enabled: false,
    // Disabled but still running — the honest next-launch case.
    state: 'ACTIVE',
  }),
  makePlugin({
    id: '@bbebee/plugin-visualizer',
    name: 'plugin-visualizer',
    displayName: 'Visualizer',
    version: '0.3.0',
    systemId: 'layer-5',
    moduleId: 'ui',
    state: 'UNLOADED',
  }),
  makePlugin({
    id: '@bbebee/core-audio-mpv',
    name: 'core-audio-mpv',
    displayName: 'MPV Audio',
    version: '0.0.0',
    systemId: 'layer-2',
    moduleId: 'playback',
    state: 'ACTIVE',
  }),
]

/** The real CRITICAL_PROVIDER refusal the headless service throws (verbatim). */
const CRITICAL_REFUSAL =
  '插件 "@bbebee/plugin-history" 提供关键服务（audio），不可关闭'

/* ── harness ─────────────────────────────────────────────────────────────── */

interface ManagerStubOptions {
  plugins?: readonly PluginInfo[]
  /** When set, `setEnabled` rejects with this error (the service's refusal). */
  setEnabledError?: string
}

async function makeHarness(options: ManagerStubOptions = {}) {
  const calls: string[] = []
  let plugins: PluginInfo[] = [...(options.plugins ?? MANIFEST_PLUGINS)]
  let managerCtx: Context | undefined

  class PluginManagerStub extends Service implements Partial<PluginManagerService> {
    constructor(ctx: Context) {
      super(ctx, 'plugin-manager')
      managerCtx = ctx
    }
    list = (): readonly PluginInfo[] => plugins
    setEnabled = async (id: string, enabled: boolean): Promise<void> => {
      calls.push(`set-enabled:${id}:${enabled}`)
      if (options.setEnabledError) throw new Error(options.setEnabledError)
      // Mirror the real service: mutate, then emit. The real one persists to
      // the store and (desktop only) bridges to the loader — mobile has no
      // bridge, so the runtime state below is deliberately left untouched.
      plugins = plugins.map((p) => (p.id === id ? { ...p, enabled } : p))
      managerCtx?.emit('plugin-manager/enabled-changed', { id, enabled })
      managerCtx?.emit('plugin-manager/changed')
    }
  }

  /** English-only i18n stub over the real `settings` and `app` catalogues. */
  class EnglishI18nStub extends Service implements I18nService {
    static override readonly name = 'i18n'
    locale = 'en'
    constructor(ctx: Context) {
      super(ctx, 'i18n')
    }
    t = (key: string, params?: Record<string, string | number>): string => {
      const sep = key.indexOf(':')
      if (sep < 0) return key
      const catalogue = key.slice(0, sep) === 'settings'
        ? (settingsCatalogue as { en: Record<string, unknown> }).en
        : (appCatalogue as Record<string, unknown>)
      let cur: unknown = catalogue
      for (const part of key.slice(sep + 1).split('.')) {
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      }
      if (typeof cur !== 'string') return key
      return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
    }
    register = () => () => {}
    onLocaleChange = (_cb: (locale: string) => void): (() => void) => () => {}
  }

  const views = new Map<string, unknown>()
  const contributions: Array<Record<string, unknown>> = []
  const navigateCalls: string[] = []
  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    registerView = (id: string, component: unknown) => {
      views.set(id, component)
      return () => views.delete(id)
    }
    contribute = (contribution: Record<string, unknown>) => {
      contributions.push(contribution)
      return () => {
        const at = contributions.indexOf(contribution)
        if (at >= 0) contributions.splice(at, 1)
      }
    }
    navigate = (id: string) => {
      navigateCalls.push(id)
    }
    viewFor = (id: string) => views.get(id)
  }

  const root = new Context()
  await root.plugin(UiStub)
  await root.plugin(PluginManagerStub)
  await root.plugin(EnglishI18nStub)
  await new Promise((resolve) => setTimeout(resolve, 0))

  return { root, calls, views, contributions, navigateCalls, setPlugins: (next: PluginInfo[]) => void (plugins = next) }
}

/**
 * Renders the screen on a scoped context, exactly the way the shell resolves
 * a contributed view, and hands back the render queries.
 */
async function screenHarness(options: ManagerStubOptions = {}) {
  const parts = await makeHarness(options)
  let scoped: Context | undefined
  parts.root.inject(['ui', 'plugin-manager', 'i18n'], (s) => void (scoped = s))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!scoped) throw new Error('failed to scope')
  const rendered = render(h(PluginManagerScreen, { ctx: scoped as Context }))
  return { ...parts, ...rendered }
}

/* ── the plugin entry ────────────────────────────────────────────────────── */

describe('plugin-manager-ui-mobile', () => {
  it('registers the screen view and adds the settings link-row in the plugins section', async () => {
    const parts = await makeHarness()
    await parts.root.plugin(plugin)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(parts.views.has(MANAGER_VIEWS.screen)).toBe(true)

    // The mobile entrance: a settings link-row that hands `plugin-manager.screen`
    // to `ui.navigate` — the history/registry-UI pattern, in the `plugins`
    // section (the section id desktop's settings screen reserves for plugin
    // management), titled by the same key as the desktop tab.
    const linkRow = parts.contributions.find((c) => c['id'] === MANAGER_VIEWS.screen)
    expect(linkRow).toBeTruthy()
    expect(linkRow?.['kind']).toBe('settings')
    expect(linkRow?.['section']).toBe('plugins')
    expect(linkRow?.['title']).toBe('settings:settings.plugins')
    expect(linkRow?.['order']).toBe(20)
  })
})

/* ── PluginManagerScreen ─────────────────────────────────────────────────── */

describe('PluginManagerScreen on mobile', () => {
  it('lists known plugins from the manager service, grouped by layer, with versions and layers', async () => {
    const { getByTestId, findByTestId } = await screenHarness()

    await findByTestId('manager-plugin-@bbebee/plugin-history')

    expect(getByTestId('manager-group-layer-2').textContent).toContain('Core')
    expect(getByTestId('manager-group-layer-2').textContent).toContain('MPV Audio')
    expect(getByTestId('manager-group-layer-4').textContent).toContain('Features')
    expect(getByTestId('manager-group-layer-4').textContent).toContain('Plugin Manager')
    expect(getByTestId('manager-group-layer-5').textContent).toContain('UI')

    const row = getByTestId('manager-plugin-@bbebee/plugin-history')
    expect(row.textContent).toContain('History')
    expect(row.textContent).toContain('0.2.0')
    expect(row.textContent).toContain('layer-4')
    expect(row.textContent).toContain('storage')
  })

  it('shows the persisted enabled flag next to the real runtime state, and dims disabled rows', async () => {
    const { getByTestId, findByTestId } = await screenHarness()
    await findByTestId('manager-plugin-@bbebee/plugin-history')

    // Disabled but still ACTIVE: both facts on screen, never merged into a lie.
    expect(getByTestId('manager-plugin-state-@bbebee/plugin-history').textContent).toBe('Not enabled')
    expect(getByTestId('manager-toggle-@bbebee/plugin-history').getAttribute('data-state')).toContain(
      '"checked":false',
    )

    // Enabled and running.
    expect(getByTestId('manager-plugin-state-@bbebee/plugin-manager').textContent).toContain('Enabled')
    expect(getByTestId('manager-plugin-state-@bbebee/plugin-manager').textContent).toContain('ACTIVE')
  })

  it('toggles through the manager service setEnabled and refreshes from its events', async () => {
    const { getByTestId, findByTestId, calls } = await screenHarness()
    await findByTestId('manager-plugin-@bbebee/plugin-history')

    fireEvent.click(getByTestId('manager-toggle-@bbebee/plugin-history'))
    await waitFor(() => expect(calls).toContain('set-enabled:@bbebee/plugin-history:true'))
    // The stub service mutated + emitted; the list re-reads from it.
    await waitFor(() =>
      expect(getByTestId('manager-plugin-state-@bbebee/plugin-history').textContent).not.toBe('Not enabled'),
    )

    fireEvent.click(getByTestId('manager-toggle-@bbebee/plugin-visualizer'))
    await waitFor(() => expect(calls).toContain('set-enabled:@bbebee/plugin-visualizer:false'))
  })

  it('surfaces the service refusal verbatim and keeps the old state', async () => {
    const { getByTestId, findByTestId, queryByTestId, calls } = await screenHarness({
      setEnabledError: CRITICAL_REFUSAL,
    })
    await findByTestId('manager-plugin-@bbebee/plugin-history')

    fireEvent.click(getByTestId('manager-toggle-@bbebee/plugin-history'))

    // The refusal is shown verbatim — never hidden, never special-cased
    // into a friendlier lie.
    await waitFor(() => expect(getByTestId('manager-toggle-error').textContent).toContain(CRITICAL_REFUSAL))
    // The refused toggle never mutated the service: the row keeps its flag.
    expect(getByTestId('manager-plugin-state-@bbebee/plugin-history').textContent).toBe('Not enabled')
    expect(calls).toEqual(['set-enabled:@bbebee/plugin-history:true'])
    expect(queryByTestId('manager-toggle-error')).toBeTruthy()
  })

  it('locks and dims the toggle for a critical-service provider, with the refusal reason', async () => {
    const { getByTestId, findByTestId, calls } = await screenHarness()
    await findByTestId('manager-plugin-@bbebee/plugin-manager')

    // `@bbebee/plugin-manager` provides the critical `plugin-manager` key
    // (the generated protocol map): the switch renders locked.
    const toggle = getByTestId('manager-toggle-@bbebee/plugin-manager')
    expect(toggle.getAttribute('data-state')).toContain('"disabled":true')
    expect(getByTestId('manager-plugin-locked-@bbebee/plugin-manager').textContent).toContain(
      'always on, cannot be turned off',
    )
    expect(getByTestId('manager-plugin-locked-@bbebee/plugin-manager').textContent).toContain('plugin-manager')

    fireEvent.click(toggle)
    expect(calls).toEqual([])
  })

  it('shows a failed plugin’s error and the persistent next-launch hint', async () => {
    const { getByTestId, findByTestId } = await screenHarness({
      plugins: [
        makePlugin({ id: '@bbebee/plugin-broken', displayName: 'Broken', state: 'FAILED', error: 'entry exploded' }),
      ],
    })
    await findByTestId('manager-plugin-@bbebee/plugin-broken')

    expect(getByTestId('manager-plugin-error-@bbebee/plugin-broken').textContent).toContain('entry exploded')

    // The mobile semantics: no lifecycle bridge, so the hint stays on screen.
    expect(getByTestId('manager-next-launch-hint').textContent).toContain('next time the app starts')
  })

  it('renders the empty state when the service lists nothing', async () => {
    const { getByTestId } = await screenHarness({ plugins: [] })
    expect(getByTestId('manager-empty').textContent).toBe('No matching plugins')
  })
})
