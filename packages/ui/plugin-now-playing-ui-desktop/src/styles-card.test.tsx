// @vitest-environment jsdom
/**
 * Desktop now-playing styles settings card tests — the card the settings
 * screen embeds for `plugin-now-playing`'s `now-playing.styles` contribution.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { AppSettings, NowPlayingStyleMeta, SettingsService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS, NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { NowPlayingStylesSection } from './components/NowPlayingStylesSection.js'

import nowPlayingCatalogue from '../../../feature/plugin-i18n/src/locales/nowPlaying.json'

const CATALOGUES: Record<string, { en: unknown; zh: unknown }> = {
  nowPlaying: { en: nowPlayingCatalogue.en, zh: nowPlayingCatalogue.zh },
}

/**
 * English i18n stub serving the real `nowPlaying` catalogue, so components
 * under test render the same copy the app shows.
 */
class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  setLocale = (next: string): void => {
    this.locale = next
    for (const listener of [...this.listeners]) listener(next)
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const ns = key.slice(0, sep)
    const catalogue = CATALOGUES[ns]?.[this.locale === 'zh' ? 'zh' : 'en']
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

afterEach(() => {
  cleanup()
})

async function npHarness() {
  const calls: string[] = []
  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }

  class SettingsStub extends Service implements Partial<SettingsService> {
    private appCtx: Context
    public calls = calls
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

  class NowPlayingStub extends Service {
    public styles: NowPlayingStyleMeta[] = [...NOW_PLAYING_STYLES]
    public currentStyle: string = currentSettings.nowPlayingStyle || 'classic'
    private appCtx: Context
    constructor(ctx: Context) {
      super(ctx, 'nowPlaying')
      this.appCtx = ctx
    }
    getStyle = () => this.currentStyle
    getStyles = () => this.styles
    setStyle = (id: string) => {
      calls.push(`nowPlaying:setStyle:${id}`)
      this.currentStyle = id
      this.appCtx.emit('now-playing/style-changed', id)
    }
    registerStyle = (meta: NowPlayingStyleMeta) => {
      calls.push(`nowPlaying:register:${meta.id}`)
      this.styles.push(meta)
      this.appCtx.emit('now-playing/registry-changed', this.styles)
      return () => this.removeStyle(meta.id)
    }
    removeStyle = (id: string) => {
      calls.push(`nowPlaying:remove:${id}`)
      this.styles = this.styles.filter((s) => s.id !== id)
      this.appCtx.emit('now-playing/registry-changed', this.styles)
      return true
    }
  }

  const root = new Context()
  await root.plugin(SettingsStub)
  await root.plugin(NowPlayingStub)
  await root.plugin(DefaultI18nStub)

  let scoped: Context | undefined
  root.inject(['settings', 'nowPlaying'], (s) => void (scoped = s))
  await new Promise((r) => setTimeout(r, 0))
  if (!scoped) throw new Error('failed to scope')

  return { ctx: scoped, calls, settings: scoped.get('settings') as unknown as SettingsStub }
}

describe('NowPlayingStylesSection', () => {
  it('renders styles and allows switching the active one', async () => {
    const { ctx, calls, settings } = await npHarness()
    const { getByText, getByTestId } = render(h(NowPlayingStylesSection, { ctx }))

    expect(getByText('Now Playing Layout Styles')).toBeTruthy()
    expect(getByText('Classic')).toBeTruthy()
    expect(getByText('Cinematic Lyrics')).toBeTruthy()
    expect(getByText('Immersive Cover')).toBeTruthy()
    expect(getByText('Vinyl')).toBeTruthy()
    expect(getByText('Side-by-side')).toBeTruthy()

    // Select cinematic style
    const cinematicCard = getByTestId('now-playing-style-cinematic')
    expect(cinematicCard).toBeTruthy()
    fireEvent.click(cinematicCard)

    await waitFor(() => {
      expect(settings.calls.some((c) => c.includes('"nowPlayingStyle":"cinematic"'))).toBe(true)
      expect(calls.includes('nowPlaying:setStyle:cinematic')).toBe(true)
    })
  })

  it('imports a sandboxed player plugin and deletes it', async () => {
    const { ctx, calls, settings } = await npHarness()
    const { getByText, getByTestId } = render(h(NowPlayingStylesSection, { ctx }))

    // Open import modal
    const importBtn = getByTestId('import-style-button')
    fireEvent.click(importBtn)
    expect(getByText('Import an external now-playing style plugin')).toBeTruthy()
    expect(getByText('Sandbox isolation:')).toBeTruthy()

    // Try submitting empty JSON -> error
    const submitBtn = getByTestId('submit-import-style')
    fireEvent.click(submitBtn)
    expect(getByTestId('import-style-error')).toBeTruthy()
    expect(getByTestId('import-style-error').textContent).toContain('Enter or select a now-playing template plugin JSON manifest')

    // Click load sample template button
    const loadSampleBtn = getByTestId('load-sample-template-button')
    fireEvent.click(loadSampleBtn)

    const textarea = getByTestId('style-manifest-textarea') as HTMLTextAreaElement
    expect(textarea.value).toContain('sample-neon-player')
    expect(textarea.value).toContain('Neon Sandbox Player')

    // Submit valid sample template
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.includes('nowPlaying:register:sample-neon-player'))).toBe(true)
      expect(settings.calls.some((c) => c.includes('"nowPlayingStyle":"sample-neon-player"'))).toBe(true)
      expect(calls.includes('nowPlaying:setStyle:sample-neon-player')).toBe(true)
    })

    // Verify imported style card rendered with sandboxed badge
    expect(getByText('Neon Sandbox Player')).toBeTruthy()
    expect(getByText('Sandbox 🛡️')).toBeTruthy()

    // Delete custom style
    const deleteBtn = getByTestId('delete-style-sample-neon-player')
    expect(deleteBtn).toBeTruthy()
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(calls.includes('nowPlaying:remove:sample-neon-player')).toBe(true)
    })
  })
})
