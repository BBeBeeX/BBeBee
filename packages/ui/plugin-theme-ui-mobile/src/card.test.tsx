// @vitest-environment jsdom
/**
 * The mobile theme management card — the card the settings screen embeds for
 * `plugin-theme`'s `theme.settings` contribution, plus the view registration
 * and palette drive the plugin entry performs.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createElement as h, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { AppSettings, ThemeDefinition, ThemePack } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { emeraldGreenTheme, midnightPurpleTheme } from '@BBeBee/ui-tokens'
import {
  activePalette,
  configureNative,
  setPalette,
  setScheme,
} from '@BBeBee/ui-kit-mobile'
import { THEME_VIEWS } from '@bbebee/plugin-theme/views'
import { ThemeManagementCard } from './components/ThemeManagementCard.js'
import plugin from './index.js'
import themeLocales from '../../../feature/plugin-i18n/src/locales/theme.json'
import appLocales from '../../../feature/plugin-i18n/src/locales/en.json'

afterEach(() => {
  cleanup()
  setPalette(null)
  setScheme('dark')
})

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, onPress, testID, onChangeText, value, placeholder } = props
    if (name === 'TextInput') {
      return h('input', {
        'data-testid': typeof testID === 'string' ? testID : undefined,
        value: value as string,
        placeholder: placeholder as string,
        onChange: (event: { target: { value: string } }) =>
          (onChangeText as ((v: string) => void) | undefined)?.(event.target.value),
      })
    }
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
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
  FlashList: hostComponent('FlashList'),
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

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

function packOf(theme: ThemeDefinition, origin: ThemePack['origin']): ThemePack {
  return {
    id: theme.id,
    name: theme.name,
    origin,
    variants: [{ ...theme, packId: theme.id, origin }],
  }
}

const DYNAMIC_PACK: ThemePack = {
  id: 'dynamic-cover',
  name: 'Cover dynamic',
  origin: 'dynamic',
  variants: [
    { ...emeraldGreenTheme, id: 'dynamic-cover', name: 'Cover dynamic', packId: 'dynamic-cover', origin: 'dynamic' },
  ],
}

async function harness(options: { fs?: boolean } = {}) {
  const calls: string[] = []
  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }
  const packs: ThemePack[] = [
    packOf(midnightPurpleTheme, 'builtin'),
    packOf(emeraldGreenTheme, 'builtin'),
    DYNAMIC_PACK,
  ]
  let currentTheme: ThemeDefinition = midnightPurpleTheme
  const views = new Map<string, unknown>()

  class SettingsStub extends Service {
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
    private appCtx: Context
    constructor(ctx: Context) {
      super(ctx, 'theme')
      this.appCtx = ctx
    }
    getThemes = () => packs.flatMap((pack) => [...pack.variants])
    getPacks = () => [...packs]
    getCurrentTheme = () => currentTheme
    setTheme = async (id: string) => {
      calls.push(`theme:setTheme:${id}`)
      const found = this.getThemes().find((candidate) => candidate.id === id)
      if (found) {
        currentTheme = found
        this.appCtx.emit('theme/changed', found, 'dark')
      }
    }
    registerThemePack = (pack: ThemePack) => {
      calls.push(`theme:registerPack:${pack.id}`)
      const index = packs.findIndex((candidate) => candidate.id === pack.id)
      if (index >= 0) packs.splice(index, 1)
      packs.push(pack)
      this.appCtx.emit('theme/packs-changed', [...packs])
      this.appCtx.emit('theme/registry-changed', this.getThemes())
      return () => {}
    }
    registerTheme = (theme: ThemeDefinition) => {
      calls.push(`theme:register:${theme.id}`)
      packs.push(packOf(theme, 'custom'))
      this.appCtx.emit('theme/packs-changed', [...packs])
      return () => {}
    }
    removePack = (packId: string) => {
      calls.push(`theme:removePack:${packId}`)
      const index = packs.findIndex((candidate) => candidate.id === packId)
      if (index < 0) return false
      packs.splice(index, 1)
      this.appCtx.emit('theme/packs-changed', [...packs])
      return true
    }
    removeTheme = (themeId: string) => {
      calls.push(`theme:remove:${themeId}`)
      return true
    }
  }

  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    registerView = (id: string, component: unknown) => {
      views.set(id, component)
      return () => views.delete(id)
    }
    viewFor = (id: string) => views.get(id)
    navigate = (routeId: string) => void calls.push(`navigate:${routeId}`)
    contribute = () => () => {}
  }

  class FsStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'fs')
    }
    readFile = async () =>
      JSON.stringify({ id: 'picked-theme', name: 'Picked Theme', tokens: { brand: { primary: '#123456' } } })
    // The capability the protocol grows: presence is what the card checks.
    pickFiles = async () => [{ uri: 'file:///tmp/theme.json', name: 'theme.json' }]
  }

  const root = new Context()
  await root.plugin(I18nStub)
  await root.plugin(SettingsStub)
  await root.plugin(ThemeStub)
  await root.plugin(UiStub)
  if (options.fs) await root.plugin(FsStub)

  let scoped: Context | undefined
  root.inject(['settings', 'theme', 'ui', ...(options.fs ? (['fs'] as const) : [])], (s) => void (scoped = s))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!scoped) throw new Error('failed to scope')

  return { ctx: scoped, root, calls, views, packs }
}

describe('ThemeManagementCard on mobile', () => {
  it('renders the current theme, appearance modes and category tabs', async () => {
    const { ctx } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))

    expect(getByTestId('current-theme-label').textContent).toContain('Bee Music · Cyber Neon')
    expect(getByTestId('current-theme-label').textContent).not.toContain('undefined')
    for (const mode of ['system', 'dark', 'light']) {
      expect(getByTestId(`appearance-mode-${mode}`)).toBeTruthy()
    }
    for (const cat of ['builtin', 'dynamic', 'custom', 'registry']) {
      expect(getByTestId(`theme-category-${cat}`)).toBeTruthy()
    }
  })

  it('switches the theme through both services', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))

    fireEvent.click(getByTestId('theme-option-emerald-green'))
    await waitFor(() => {
      expect(calls.some((entry) => entry.includes('"themeId":"emerald-green"'))).toBe(true)
      expect(calls).toContain('theme:setTheme:emerald-green')
    })
  })

  it('switches appearance mode and writes it back to settings', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))

    fireEvent.click(getByTestId('appearance-mode-light'))
    await waitFor(() => {
      expect(calls).toContain('update:{"theme":"light"}')
    })
  })

  it('remembers the open category in settings and shows the import entry only there', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, queryByTestId } = render(h(ThemeManagementCard, { ctx }))

    expect(queryByTestId('import-theme-button')).toBeNull()
    fireEvent.click(getByTestId('theme-category-custom'))
    await waitFor(() => {
      expect(calls.some((entry) => entry.includes('"themeCategory":"custom"'))).toBe(true)
    })
    expect(getByTestId('import-theme-button')).toBeTruthy()
  })

  it('imports a pasted theme pack and enables its first variant', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, queryByTestId } = render(h(ThemeManagementCard, { ctx }))

    fireEvent.click(getByTestId('theme-category-custom'))
    fireEvent.click(getByTestId('import-theme-button'))

    // Empty submit names the problem with the shipped copy.
    fireEvent.click(getByTestId('submit-import-theme'))
    expect(getByTestId('import-theme-error').textContent).toContain('Enter or choose a theme JSON')

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
      expect(calls).toContain('theme:registerPack:acme-pack')
      expect(calls).toContain('theme:setTheme:acme-a')
      expect(calls.some((entry) => entry.includes('"themeId":"acme-a"'))).toBe(true)
      expect(calls.some((entry) => entry.includes('"themeCategory":"custom"'))).toBe(true)
    })
    expect(getByTestId('theme-option-acme-a')).toBeTruthy()
    expect(getByTestId('theme-option-acme-b')).toBeTruthy()

    fireEvent.click(getByTestId('delete-pack-acme-pack'))
    await waitFor(() => {
      expect(calls).toContain('theme:removePack:acme-pack')
      expect(queryByTestId('theme-option-acme-a')).toBeNull()
    })
  })

  it('links to the registry discover route instead of duplicating the browse UI', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))

    fireEvent.click(getByTestId('theme-category-registry'))
    fireEvent.click(getByTestId('browse-registry-link'))
    expect(calls).toContain('navigate:registry.screen')
  })

  it('offers the dynamic theme and its matugen preferences', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(ThemeManagementCard, { ctx }))

    fireEvent.click(getByTestId('theme-category-dynamic'))
    expect(getByTestId('theme-option-dynamic-cover')).toBeTruthy()
    expect(getByTestId('dynamic-contrast')).toBeTruthy()
    for (const scheme of ['tonal-spot', 'vibrant', 'expressive', 'content', 'neutral']) {
      expect(getByTestId(`dynamic-scheme-${scheme}`)).toBeTruthy()
    }
    fireEvent.click(getByTestId('dynamic-scheme-vibrant'))
    await waitFor(() => {
      expect(calls.some((entry) => entry.includes('"dynamicTheme"') && entry.includes('"scheme":"vibrant"'))).toBe(true)
    })
  })

  it('offers file import only when the fs service can pick files', async () => {
    const withPick = await harness({ fs: true })
    const { getByTestId } = render(h(ThemeManagementCard, { ctx: withPick.ctx }))
    fireEvent.click(getByTestId('theme-category-custom'))
    fireEvent.click(getByTestId('import-theme-button'))

    const pickButton = getByTestId('choose-theme-file-btn')
    fireEvent.click(pickButton)
    await waitFor(() => {
      expect((getByTestId('import-theme-textarea') as HTMLInputElement).value).toContain('picked-theme')
    })

    cleanup()
    const withoutPick = await harness()
    const second = render(h(ThemeManagementCard, { ctx: withoutPick.ctx }))
    fireEvent.click(second.getByTestId('theme-category-custom'))
    fireEvent.click(second.getByTestId('import-theme-button'))
    expect(second.queryByTestId('choose-theme-file-btn')).toBeNull()
  })

  it('registers the theme.settings view and drives the palette on apply', async () => {
    const { root, views } = await harness()
    await act(async () => {
      await root.plugin(plugin)
    })
    expect(views.has(THEME_VIEWS.settingsCard)).toBe(true)

    // The palette drive is live: the kit resolver now serves the theme.
    expect(activePalette().accent.base).toBe(midnightPurpleTheme.tokens.brand.primary)
    act(() => {
      root.emit('theme/changed', emeraldGreenTheme, 'dark')
    })
    expect(activePalette().accent.base).toBe(emeraldGreenTheme.tokens.brand.primary)
  })
})
