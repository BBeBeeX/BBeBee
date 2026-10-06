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
import { midnightPurpleTheme, spotifyTheme } from '@BBeBee/ui-tokens'
import { ThemeManagementCard } from './components/ThemeManagementCard.js'
import { THEME_VIEWS } from '@BBeBee/plugin-theme/views'
import plugin from './index.js'

afterEach(() => {
  cleanup()
})

async function harness() {
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
    public themes: ThemeDefinition[] = [midnightPurpleTheme, spotifyTheme]
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
      if (id === 'midnight-purple' || id === 'spotify') return false
      this.themes = this.themes.filter((t) => t.id !== id)
      if (this.currentTheme.id === id) {
        this.currentTheme = this.themes[0]!
      }
      this.appCtx.emit('theme/registry-changed', this.themes)
      return true
    }
  }

  const root = new Context()
  await root.plugin(SettingsStub)
  await root.plugin(ThemeStub)

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

    expect(getByText('Bee Music · Cyber Neon (蓝紫电光)')).toBeTruthy()
    expect(getByText('Spotify 经典绿 (Spotify Classic)')).toBeTruthy()

    fireEvent.click(getByTestId('theme-option-spotify'))
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"themeId":"spotify"'))).toBe(true)
      expect(calls.some((c) => c.includes('theme:setTheme:spotify'))).toBe(true)
    })
  })

  it('imports a custom theme JSON and deletes it again', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, queryByTestId, getAllByText } = render(
      h(ThemeManagementCard, { ctx }),
    )

    fireEvent.click(getByTestId('import-theme-button'))
    expect(getAllByText('导入色彩模式').length).toBeGreaterThanOrEqual(1)

    fireEvent.click(getByTestId('submit-import-theme'))
    expect(getByTestId('import-theme-error').textContent).toContain('请输入或选择色彩模式 JSON')

    fireEvent.change(getByTestId('import-theme-textarea'), {
      target: {
        value: JSON.stringify({
          id: 'neon-cyber',
          name: '霓虹赛博 (Neon Cyber)',
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
