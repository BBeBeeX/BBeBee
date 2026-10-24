// @vitest-environment jsdom
/**
 * Desktop theme settings card tests — the card the settings screen embeds
 * for `plugin-theme`'s `theme.settings` contribution.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { AppSettings, SettingsService, ThemeDefinition } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { midnightPurpleTheme, emeraldGreenTheme } from '@BBeBee/ui-tokens'
import { ThemeManagementCard } from './components/ThemeManagementCard.js'
import { THEME_VIEWS } from '@bbebee/plugin-theme/views'
import plugin from './index.js'
import themeLocales from '../../../feature/plugin-i18n/src/locales/theme.json'
import appLocales from '../../../feature/plugin-i18n/src/locales/en.json'

/**
 * English stub for `ctx.i18n` — resolves keys against the shipped en
 * catalogues so assertions keep reading the English copy. Test-only; the
 * real service is provided by `@bbebee/plugin-i18n` in the app.
 */
class I18nStub extends Service {
  public locale = 'en'
  private catalogues: Record<string, Record<string, string>> = {}

  constructor(ctx: Context) {
    super(ctx, 'i18n')
    const flatten = (node: unknown, prefix: string, out: Record<string, string>): void => {
      if (typeof node === 'string') {
        out[prefix] = node
        return
      }
      if (typeof node === 'object' && node !== null) {
        for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
      }
    }
    const themeEn: Record<string, string> = {}
    const appEn: Record<string, string> = {}
    flatten((themeLocales as unknown as { en: unknown }).en, '', themeEn)
    flatten(appLocales as unknown, '', appEn)
    this.catalogues = { theme: themeEn, app: appEn }
  }

  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    let text = key
    if (sep > 0) {
      const hit = this.catalogues[key.slice(0, sep)]?.[key.slice(sep + 1)]
      if (hit !== undefined) text = hit
    }
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (m: string, p: string) =>
        params[p] !== undefined ? String(params[p]) : m,
      )
    }
    return text
  }

  onLocaleChange = (): (() => void) => () => {}
}

afterEach(() => {
  cleanup()
})

async function harness(withRegistry = false) {
  const calls: string[] = []
  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }

  class SettingsStub extends Service implements Partial<SettingsService> {
    private appCtx: Context
    constructor(ctx: Context) {
      super(ctx, 'settings')
      this.appCtx = ctx
    }
    getSync = (): AppSettings => currentSettings
    update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      calls.push(`update:${JSON.stringify(patch)}`)
      currentSettings = { ...currentSettings, ...patch }
      this.appCtx.emit('settings/changed', currentSettings)
      return currentSettings
    }
  }

  class ThemeStub extends Service {
    public themes: ThemeDefinition[] = [midnightPurpleTheme, emeraldGreenTheme]
    public currentTheme: ThemeDefinition = this.themes[0]!
    private appCtx: Context
    constructor(ctx: Context) {
      super(ctx, 'theme')
      this.appCtx = ctx
    }
    getThemes = () => this.themes
    getCurrentTheme = () => this.currentTheme
    setTheme = async (id: string) => {
      calls.push(`theme:setTheme:${id}`)
      const found = this.themes.find((t) => t.id === id)
      if (found) {
        this.currentTheme = found
        this.appCtx.emit('theme/changed', found)
      }
    }
    registerTheme = (theme: ThemeDefinition) => {
      calls.push(`theme:register:${theme.id}`)
      this.themes.push(theme)
      this.appCtx.emit('theme/registry-changed', this.themes)
      return () => this.removeTheme(theme.id)
    }
    removeTheme = (id: string) => {
      calls.push(`theme:remove:${id}`)
      if (id === 'midnight-purple' || id === 'emerald-green') return false
      this.themes = this.themes.filter((t) => t.id !== id)
      if (this.currentTheme.id === id) {
        this.currentTheme = this.themes[0]!
      }
      this.appCtx.emit('theme/registry-changed', this.themes)
      return true
    }
  }

  class RegistryStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'contentRegistry')
    }
    getIndex = async () => ({
      entries: [
        {
          id: 'deepmono',
          kind: 'theme',
          name: 'Deep Mono',
          description: 'Monochrome pack',
          version: '1.0.0',
          variantCount: 2,
          variants: [
            { id: 'deepmono-graphite', name: 'Graphite', isDark: true },
            { id: 'deepmono-paper', name: 'Paper', isDark: false },
          ],
          previewColors: ['#101014', '#1d1d22', '#e8e8e8'],
        },
      ],
    })
    install = async () => {}
  }

  const root = new Context()
  await root.plugin(I18nStub)
  await root.plugin(SettingsStub)
  await root.plugin(ThemeStub)
  if (withRegistry) await root.plugin(RegistryStub)

  let scoped: Context | undefined
  root.inject(['settings', 'theme'], (s) => void (scoped = s))
  await new Promise((r) => setTimeout(r, 0))
  if (!scoped) throw new Error('failed to scope')

  return { ctx: scoped, calls }
}

describe('ThemeManagementCard', () => {
  it('lists themes and switches the active one through both services', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, getByText } = render(h(ThemeManagementCard, { ctx }))

    expect(getByText('Bee Music · Cyber Neon')).toBeTruthy()
    expect(getByText('Emerald Green')).toBeTruthy()

    fireEvent.click(getByTestId('theme-option-emerald-green'))
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"themeId":"emerald-green"'))).toBe(true)
      expect(calls.some((c) => c.includes('theme:setTheme:emerald-green'))).toBe(true)
    })
  })

  it('imports a custom theme JSON and deletes it again', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, queryByTestId, getAllByText } = render(
      h(ThemeManagementCard, { ctx }),
    )

    fireEvent.click(getByTestId('theme-category-custom'))
    fireEvent.click(getByTestId('import-theme-button'))
    expect(getAllByText('Import theme').length).toBeGreaterThanOrEqual(1)

    fireEvent.click(getByTestId('submit-import-theme'))
    expect(getByTestId('import-theme-error').textContent).toContain('Enter or choose a theme JSON')

    fireEvent.change(getByTestId('import-theme-textarea'), {
      target: {
        value: JSON.stringify({
          id: 'neon-cyber',
          name: 'Neon Cyber',
          tokens: { brand: { primary: '#00FFFF' } },
        }),
      },
    })
    fireEvent.click(getByTestId('submit-import-theme'))

    await waitFor(() => {
      expect(getByTestId('theme-option-neon-cyber')).toBeTruthy()
      expect(calls.some((c) => c.includes('theme:register:neon-cyber'))).toBe(true)
      expect(calls.some((c) => c.includes('"themeId":"neon-cyber"'))).toBe(true)
    })

    fireEvent.click(getByTestId('delete-theme-neon-cyber'))
    await waitFor(() => {
      expect(queryByTestId('theme-option-neon-cyber')).toBeNull()
      expect(calls.some((c) => c.includes('theme:remove:neon-cyber'))).toBe(true)
    })
  })

  it('registers the theme.settings view under the descriptor id', async () => {
    const calls: string[] = []
    let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }

    class SettingsStub extends Service implements Partial<SettingsService> {
      private appCtx: Context
      constructor(ctx: Context) {
        super(ctx, 'settings')
        this.appCtx = ctx
      }
      getSync = (): AppSettings => currentSettings
      update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
        currentSettings = { ...currentSettings, ...patch }
        this.appCtx.emit('settings/changed', currentSettings)
        return currentSettings
      }
    }

    class ThemeStub extends Service {
      public themes: ThemeDefinition[] = [midnightPurpleTheme]
      public currentTheme: ThemeDefinition = this.themes[0]!
      constructor(ctx: Context) {
        super(ctx, 'theme')
      }
      getThemes = () => this.themes
      getCurrentTheme = () => this.currentTheme
      setTheme = async (id: string) => {
        calls.push(id)
      }
      registerTheme = (theme: ThemeDefinition) => {
        this.themes.push(theme)
        return () => this.removeTheme(theme.id)
      }
      removeTheme = (id: string) => {
        this.themes = this.themes.filter((t) => t.id !== id)
        return true
      }
    }

    const views = new Map<string, unknown>()
    class UiStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'ui')
      }
      registerView = (id: string, component: unknown) => {
        views.set(id, component)
        return () => views.delete(id)
      }
      contribute = () => () => {}
      navigate = () => {}
      viewFor = (id: string) => views.get(id)
    }

    const root = new Context()
    await root.plugin(UiStub)
    await root.plugin(SettingsStub)
    await root.plugin(ThemeStub)
    await root.plugin(plugin)
    expect(views.has(THEME_VIEWS.settingsCard)).toBe(true)
  })

  it('switches appearance mode and writes back to settings', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))

    const lightBtn = getByTestId('appearance-mode-light')
    expect(lightBtn.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(lightBtn)

    await waitFor(() => {
      expect(calls).toContain('update:{"theme":"light"}')
      expect(lightBtn.getAttribute('aria-checked')).toBe('true')
    })
  })
})

describe('ThemeManagementCard categories, packs and glass', () => {
  it('shows the current theme label and the four category tabs', async () => {
    const { ctx } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))
    expect(getByTestId('current-theme-label').textContent).toContain('Bee Music · Cyber Neon')
    expect(getByTestId('current-theme-label').textContent).not.toContain('undefined')
    for (const cat of ['builtin', 'dynamic', 'custom', 'registry']) {
      expect(getByTestId(`theme-category-${cat}`)).toBeTruthy()
    }
  })

  it('writes dynamic scheme and contrast into settings', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))
    fireEvent.click(getByTestId('theme-category-dynamic'))
    fireEvent.change(getByTestId('dynamic-scheme'), { target: { value: 'vibrant' } })
    fireEvent.change(getByTestId('dynamic-contrast'), { target: { value: '40' } })
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"dynamicTheme"') && c.includes('"scheme":"vibrant"'))).toBe(true)
      expect(calls.some((c) => c.includes('"contrast":40'))).toBe(true)
    })
  })

  it('imports a multi-variant pack JSON into the custom category and deletes the pack', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, queryByTestId } = render(h(ThemeManagementCard, { ctx }))
    fireEvent.click(getByTestId('theme-category-custom'))
    fireEvent.click(getByTestId('import-theme-button'))
    fireEvent.change(getByTestId('import-theme-textarea'), {
      target: {
        value: JSON.stringify({
          id: 'acme-pack',
          name: 'Acme Pack',
          variants: [
            { id: 'acme-a', name: 'Acme A', tokens: { brand: { primary: '#FF0000' } } },
            { id: 'acme-b', name: 'Acme B', tokens: { brand: { primary: '#00FF00' } } },
          ],
        }),
      },
    })
    fireEvent.click(getByTestId('submit-import-theme'))
    await waitFor(() => {
      expect(getByTestId('theme-option-acme-a')).toBeTruthy()
      expect(getByTestId('theme-option-acme-b')).toBeTruthy()
      expect(calls.some((c) => c.includes('theme:register:acme-a'))).toBe(true)
      expect(calls.some((c) => c.includes('"themeCategory":"custom"'))).toBe(true)
    })
    fireEvent.click(getByTestId('delete-pack-acme-pack'))
    await waitFor(() => {
      expect(queryByTestId('theme-option-acme-a')).toBeNull()
      expect(queryByTestId('theme-option-acme-b')).toBeNull()
    })
  })

  it('shows the import button only in the custom category panel', async () => {
    const { ctx } = await harness()
    const { getByTestId, queryByTestId } = render(h(ThemeManagementCard, { ctx }))
    for (const cat of ['builtin', 'dynamic', 'registry'] as const) {
      fireEvent.click(getByTestId(`theme-category-${cat}`))
      expect(getByTestId(`theme-panel-${cat}`)).toBeTruthy()
      expect(queryByTestId('import-theme-button')).toBeNull()
    }
    fireEvent.click(getByTestId('theme-category-custom'))
    const panel = getByTestId('theme-panel-custom')
    const button = getByTestId('import-theme-button')
    expect(panel.contains(button)).toBe(true)
  })

  it('renders browse previews from the entry preview colours', async () => {
    const { ctx } = await harness(true)
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))
    fireEvent.click(getByTestId('theme-category-registry'))
    await waitFor(() => {
      expect(getByTestId('browse-preview-deepmono')).toBeTruthy()
    })
    const preview = getByTestId('browse-preview-deepmono')
    expect(preview.style.background).toContain('rgb(16, 16, 20)')
    expect(getByTestId('browse-theme-deepmono').textContent).toContain('Graphite')
  })

  it('writes glass window and component settings with per-surface overrides', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))
    fireEvent.click(getByTestId('glass-window-toggle'))
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"glass"') && c.includes('"enabled":true'))).toBe(true)
    })
    fireEvent.click(getByTestId('glass-components-toggle'))
    // Per-surface overrides live in their own collapsed group.
    fireEvent.click(getByTestId('glass-surfaces-expand'))
    fireEvent.change(getByTestId('glass-surface-sidebar-opacity'), { target: { value: '66' } })
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"sidebar"') && c.includes('"opacity":66'))).toBe(true)
    })
  })

  it('glass regions pop open with their switch and fold away independently', async () => {
    const { ctx } = await harness()
    const { getByTestId, queryByTestId } = render(h(ThemeManagementCard, { ctx }))
    expect(queryByTestId('glass-window-region')).toBeNull()
    expect(queryByTestId('glass-components-region')).toBeNull()

    // Switching a layer on pops its adjustment region open.
    fireEvent.click(getByTestId('glass-window-toggle'))
    expect(queryByTestId('glass-window-region')).toBeTruthy()
    expect(getByTestId('glass-window-tint')).toBeTruthy()

    // The chevron folds the region away without disabling the layer.
    fireEvent.click(getByTestId('glass-window-expand'))
    expect(queryByTestId('glass-window-region')).toBeNull()
    expect(getByTestId('glass-window-toggle').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(getByTestId('glass-window-expand'))
    expect(queryByTestId('glass-window-region')).toBeTruthy()

    // Components: sliders appear on switch-on; the per-surface group
    // stays folded until its own chevron is clicked.
    fireEvent.click(getByTestId('glass-components-toggle'))
    expect(queryByTestId('glass-components-region')).toBeTruthy()
    expect(getByTestId('glass-blur')).toBeTruthy()
    expect(queryByTestId('glass-surfaces-region')).toBeNull()
    fireEvent.click(getByTestId('glass-surfaces-expand'))
    expect(queryByTestId('glass-surfaces-region')).toBeTruthy()
    expect(getByTestId('glass-surface-player-blur')).toBeTruthy()
  })
})
